//! Settlement: ask for the rainfall, then pay the holder or release the collateral.
//!
//! Two ways a reading can arrive, and the contract treats them identically once it has
//! one. `settle` asks a hash-pinned program in OutLayer's TEE; `submit_observation` lets
//! a trusted keeper post it. Which one shipped is stated on every policy as
//! `reading.source`, so a reader can see what they are trusting without taking the
//! README's word for it. See THREAT_MODEL.md T16 and T17.
//!
//! Both funnel into `apply_reading`, which is the only place a policy's outcome is
//! decided.

use crate::dates::now_unix;
use crate::{
    Contract, ContractExt, OracleSource, PolicyStatus, Reading, TransferPurpose, Usdc,
};
use near_sdk::json_types::{U64, U128};
use near_sdk::{
    AccountId, Gas, Promise, PromiseError, PromiseOrValue, env, near, require, serde_json,
};

/// Gas for OutLayer's `request_execution` and the work it schedules.
const GAS_OUTLAYER: Gas = Gas::from_tgas(100);
/// Our callback does bookkeeping and at most one NEP-141 transfer.
const GAS_ORACLE_CALLBACK: Gas = Gas::from_tgas(40);

#[near]
impl Contract {
    /// Ask the oracle for this policy's rainfall. Callable by anyone.
    ///
    /// The caller attaches the NEAR for the off-chain run and is refunded whatever is
    /// unused — but note that OutLayer does **not** refund failed executions, so a call
    /// made too early costs the caller. That is why the settle delay exists.
    #[payable]
    pub fn settle(&mut self, policy_id: U64) -> Promise {
        let id = policy_id.0;
        let policy = self
            .policies
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such policy"));

        require!(
            matches!(policy.status, PolicyStatus::Active),
            "policy is already settled"
        );
        // Invariant 3, first half: never early.
        require!(
            now_unix() >= policy.settle_allowed_at(self.config.settle_delay_days),
            "too early: the window plus the settle delay has not elapsed"
        );
        // Re-entrancy guard across the async gap. See THREAT_MODEL.md T3.
        require!(!policy.settling, "a settlement is already in flight");
        require!(
            !self.config.oracle_wasm_url.is_empty(),
            "no oracle wasm configured; this deployment settles via submit_observation"
        );
        require!(
            !env::attached_deposit().is_zero(),
            "attach NEAR to pay for the oracle run"
        );

        self.policies.get_mut(&id).unwrap().settling = true;

        let input = serde_json::json!({
            "lat_e4": policy.terms.lat_e4,
            "lon_e4": policy.terms.lon_e4,
            "start": policy.terms.start,
            "days": policy.terms.days,
        })
        .to_string();

        // `resource_limits` is required: OutLayer runs nothing without it. The source is
        // pinned by sha256, so a worker that served different bytes would be refused.
        let args = serde_json::json!({
            "source": {
                "WasmUrl": {
                    "url": self.config.oracle_wasm_url,
                    "hash": self.config.oracle_wasm_sha256,
                    "build_target": "wasm32-wasip2",
                }
            },
            "resource_limits": {
                "max_instructions": 1_000_000_000u64,
                "max_memory_mb": 128u32,
                "max_execution_seconds": 30u64,
            },
            "input_data": input,
            "response_format": "Json",
        })
        .to_string();

        env::log_str(&format!("policy {} settling via OutLayer", id));

        Promise::new(self.config.outlayer_account.clone())
            .function_call(
                "request_execution".to_string(),
                args.into_bytes(),
                env::attached_deposit(),
                GAS_OUTLAYER,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ORACLE_CALLBACK)
                    .on_oracle_result(policy_id),
            )
    }

    /// Receives the oracle's stdout and decides the policy.
    ///
    /// On any failure the policy is left `Active` with `settling` cleared, so `settle`
    /// can be called again. It is never left in a state only an owner could rescue.
    #[private]
    pub fn on_oracle_result(
        &mut self,
        policy_id: U64,
        #[callback_result] result: Result<serde_json::Value, PromiseError>,
    ) -> PromiseOrValue<bool> {
        let id = policy_id.0;
        if let Some(p) = self.policies.get_mut(&id) {
            p.settling = false;
        } else {
            return PromiseOrValue::Value(false);
        }

        let value = match result {
            Ok(v) => v,
            Err(_) => {
                env::log_str("oracle execution failed; policy stays active and settle can be retried");
                return PromiseOrValue::Value(false);
            }
        };

        let Some((mm_x10, days_valid)) = parse_reading(&value) else {
            env::log_str(&format!(
                "oracle returned an unreadable payload ({}); policy stays active",
                value
            ));
            return PromiseOrValue::Value(false);
        };

        let execution_ref = value
            .get("execution_id")
            .or_else(|| value.get("executionId"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        self.apply_reading(id, mm_x10, days_valid, OracleSource::OutLayer { execution_ref })
    }

    /// Keeper path. Posts a reading for a policy without an off-chain proof.
    ///
    /// In this mode the keeper is trusted completely: it can trigger payouts that are
    /// not owed and deny ones that are. `scripts/verify-oracle` makes a dishonest
    /// reading detectable by anyone after the fact, but does not prevent it. The README
    /// says so in those words. See THREAT_MODEL.md T16.
    pub fn submit_observation(
        &mut self,
        policy_id: U64,
        mm_x10: u32,
        days_valid: u16,
    ) -> PromiseOrValue<bool> {
        let account_id = env::predecessor_account_id();
        require!(
            account_id == self.config.keeper_account,
            "only the configured keeper may submit observations"
        );
        let id = policy_id.0;
        let policy = self
            .policies
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such policy"));
        require!(
            matches!(policy.status, PolicyStatus::Active),
            "policy is already settled"
        );
        require!(!policy.settling, "a settlement is already in flight");
        // Invariant 3, first half, applies to this path too.
        require!(
            now_unix() >= policy.settle_allowed_at(self.config.settle_delay_days),
            "too early: the window plus the settle delay has not elapsed"
        );

        self.apply_reading(id, mm_x10, days_valid, OracleSource::Keeper { account_id })
    }

    /// The single place a policy's outcome is decided.
    fn apply_reading(
        &mut self,
        id: u64,
        mm_x10: u32,
        days_valid: u16,
        source: OracleSource,
    ) -> PromiseOrValue<bool> {
        let policy = self.policies.get(&id).cloned().unwrap();

        // A partial window is a failed read, not a cheap payout: missing days contribute
        // nothing to the total, so an incomplete window looks drier than it was.
        // See THREAT_MODEL.md T19.
        if days_valid != policy.terms.days {
            env::log_str(&format!(
                "policy {} read only {} of {} days; rejected, settle can be retried",
                id, days_valid, policy.terms.days
            ));
            return PromiseOrValue::Value(false);
        }

        let payout: Usdc = policy.terms.payout.0;
        let pays = mm_x10 < policy.terms.strike_mm_x10;

        // The collateral is released either way; what differs is where it goes.
        let mut uw = self.underwriters.get(&policy.underwriter).cloned().unwrap_or_default();
        uw.locked = U128(uw.locked.0.saturating_sub(payout));
        if !pays {
            uw.free = U128(uw.free.0 + payout);
        }
        self.underwriters.insert(policy.underwriter.clone(), uw);
        self.total_locked -= payout;
        if !pays {
            self.total_free += payout;
        }

        {
            let p = self.policies.get_mut(&id).unwrap();
            p.settling = false;
            p.status = if pays { PolicyStatus::PaidOut } else { PolicyStatus::Expired };
            p.reading = Some(Reading {
                mm_x10,
                days_valid,
                source,
                observed_at: U64(env::block_timestamp()),
            });
        }

        if pays {
            // Invariant 4. The recipient is read here, at callback time, from the token's
            // current owner — never captured when `settle` was called. A seller who
            // settles and then sells during the async gap does not get the money.
            // See THREAT_MODEL.md T1.
            let holder: AccountId = self.policies.get(&id).unwrap().owner_id.clone();
            env::log_str(&format!(
                "policy {} pays {} to holder {} ({}mm < {}mm strike)",
                id,
                payout,
                holder,
                mm_x10 as f64 / 10.0,
                policy.terms.strike_mm_x10 as f64 / 10.0
            ));
            // Returned, not dropped: the payout must be unmistakably scheduled rather
            // than relying on near-sdk's Drop impl to construct the promise for us.
            return PromiseOrValue::Promise(self.send_usdc(
                holder.clone(),
                U128(payout),
                "mmiri payout",
                TransferPurpose::Payout { policy_id: U64(id), account_id: holder },
            ));
        } else {
            env::log_str(&format!(
                "policy {} expired without payout ({}mm >= {}mm strike); collateral released to {}",
                id,
                mm_x10 as f64 / 10.0,
                policy.terms.strike_mm_x10 as f64 / 10.0,
                policy.underwriter
            ));
        }
        PromiseOrValue::Value(true)
    }

    /// What the caller should attach to `settle`, straight from OutLayer's own estimate.
    pub fn oracle_account(&self) -> AccountId {
        self.config.outlayer_account.clone()
    }
}

/// Pulls `mm_x10` and `days_valid` out of whatever OutLayer handed back.
///
/// Written defensively on purpose. The docs describe stdout being parsed per
/// `response_format`, but whether the contract receives the bare object or an envelope
/// around it is the one thing Gate 0 has to establish by running it. Accepting an object
/// or a JSON string containing one costs a few lines and removes a redeploy from the
/// critical path.
fn parse_reading(value: &serde_json::Value) -> Option<(u32, u16)> {
    fn from_obj(v: &serde_json::Value) -> Option<(u32, u16)> {
        let mm = v.get("mm_x10")?.as_u64()?;
        let days = v.get("days_valid")?.as_u64()?;
        Some((u32::try_from(mm).ok()?, u16::try_from(days).ok()?))
    }

    if let Some(found) = from_obj(value) {
        return Some(found);
    }
    // stdout delivered as a JSON string, or nested under a result/output key.
    if let Some(s) = value.as_str() {
        if let Ok(inner) = serde_json::from_str::<serde_json::Value>(s) {
            return from_obj(&inner);
        }
    }
    for key in ["result", "output", "stdout", "value", "data"] {
        if let Some(inner) = value.get(key) {
            if let Some(found) = from_obj(inner) {
                return Some(found);
            }
            if let Some(s) = inner.as_str() {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(s) {
                    if let Some(found) = from_obj(&parsed) {
                        return Some(found);
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::parse_reading;
    use near_sdk::serde_json::json;

    #[test]
    fn reads_a_bare_object() {
        let v = json!({"mm_x10": 536, "days_valid": 30, "source": "NASA POWER PRECTOTCORR"});
        assert_eq!(parse_reading(&v), Some((536, 30)));
    }

    #[test]
    fn reads_stdout_delivered_as_a_string() {
        let v = json!("{\"mm_x10\":536,\"days_valid\":30}");
        assert_eq!(parse_reading(&v), Some((536, 30)));
    }

    #[test]
    fn reads_an_envelope() {
        let v = json!({"result": {"mm_x10": 1137, "days_valid": 30}});
        assert_eq!(parse_reading(&v), Some((1137, 30)));
    }

    #[test]
    fn rejects_nonsense() {
        assert_eq!(parse_reading(&json!({"oops": true})), None);
        assert_eq!(parse_reading(&json!("not json")), None);
    }
}
