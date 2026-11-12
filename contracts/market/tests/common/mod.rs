//! Shared sandbox harness for the invariant suite.
//!
//! Build the contracts first; `scripts/test` does both steps in order:
//!
//! ```text
//! cargo build --target wasm32-unknown-unknown --release
//! cargo test
//! ```

#![allow(dead_code)]

use near_workspaces::types::NearToken;
use near_workspaces::{Account, Contract, Worker, network::Sandbox};
use serde_json::json;
use sha2::{Digest, Sha256};

/// 1 USDC in base units.
pub const USDC: u128 = 1_000_000;
/// Bond held per commit: 1 USDC.
pub const BOND: u128 = USDC;
/// Every policy in the suite pays 50 USDC.
pub const PAYOUT: u128 = 50 * USDC;

/// Phase lengths must comfortably exceed the WALL-CLOCK time the test spends inside
/// them, not just be short enough to fast-forward. A 2-second commit window looked fine
/// and passed most runs, but three sequential commit transactions take longer than that
/// in the sandbox, so the third was intermittently rejected for arriving after the
/// deadline. A suite that fails one run in three is worse than a slow one.
pub const COMMIT_SECONDS: u32 = 30;
/// Same reasoning as the commit window: long enough for several reveal transactions,
/// and wide enough that `ff_past` lands inside it rather than stepping clean over.
pub const REVEAL_SECONDS: u32 = 30;
pub const SETTLE_DELAY_DAYS: u16 = 4;

/// Block chunk used when stepping toward a deadline. Sandbox blocks run a little under
/// half a second, so this steps the clock in ~4s hops — coarse enough to cross a
/// 30-second window quickly, fine enough to land well inside it.
pub const FF_CHUNK: u64 = 10;

fn wasm(name: &str) -> anyhow::Result<Vec<u8>> {
    let path = format!("../../target/wasm32-unknown-unknown/release/{name}.wasm");
    std::fs::read(&path).map_err(|e| {
        anyhow::anyhow!(
            "could not read {path}: {e}\n\
             Build the contracts first:\n  \
             cargo build --target wasm32-unknown-unknown --release"
        )
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Solvency {
    pub total_free: u128,
    pub total_locked: u128,
    pub total_escrow: u128,
    pub total_bonds: u128,
    pub total_claimable: u128,
    pub obligations: u128,
    pub tracked_balance: u128,
    pub balanced: bool,
}

fn u128_at(v: &serde_json::Value, key: &str) -> u128 {
    v[key].as_str().unwrap_or("0").parse().unwrap_or(0)
}

pub struct Ctx {
    pub worker: Worker<Sandbox>,
    pub usdc: Contract,
    pub market: Contract,
    pub buyer: Account,
    pub uw: Vec<Account>,
    pub keeper: Account,
    pub outsider: Account,
}

impl Ctx {
    /// Demo mode on: past windows allowed, so real seasons can be used.
    pub async fn new() -> anyhow::Result<Self> {
        Self::new_with(true).await
    }

    /// Demo mode off, for the one test that proves invariant 6 is enforced.
    pub async fn new_strict() -> anyhow::Result<Self> {
        Self::new_with(false).await
    }

    pub async fn new_with(demo_mode: bool) -> anyhow::Result<Self> {
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;

        let mk = |name: &str| {
            let root = root.clone();
            let name = name.to_string();
            async move {
                root.create_subaccount(&name)
                    .initial_balance(NearToken::from_near(50))
                    .transact()
                    .await?
                    .into_result()
                    .map_err(anyhow::Error::from)
            }
        };

        let buyer = mk("buyer").await?;
        let keeper = mk("keeper").await?;
        let outsider = mk("outsider").await?;
        let mut uw = Vec::new();
        for i in 1..=3 {
            uw.push(mk(&format!("uw-{i}")).await?);
        }

        let usdc = worker.dev_deploy(&wasm("mmiri_usdc")?).await?;
        usdc.call("new")
            .args_json(json!({
                "owner_id": root.id(),
                "total_supply": "0",
            }))
            .transact()
            .await?
            .into_result()?;

        let market = worker.dev_deploy(&wasm("mmiri_market")?).await?;
        market
            .call("new")
            .args_json(json!({
                "owner_id": root.id(),
                "usdc_account": usdc.id(),
                // No OutLayer in the sandbox: these tests exercise the keeper path,
                // which shares apply_reading with the oracle callback.
                "outlayer_account": "outlayer.testnet",
                "keeper_account": keeper.id(),
                "oracle_wasm_url": "",
                "oracle_wasm_sha256": "",
                "commit_seconds": COMMIT_SECONDS,
                "reveal_seconds": REVEAL_SECONDS,
                "settle_delay_days": SETTLE_DELAY_DAYS,
                "bid_bond": BOND.to_string(),
                // Past windows, so real seasons (2025 pays, 2026 does not) can be used.
                "demo_mode": demo_mode,
            }))
            .transact()
            .await?
            .into_result()?;

        let ctx = Self { worker, usdc, market, buyer, uw, keeper, outsider };

        // Everyone who will hold or receive USDC needs a storage deposit, the market
        // contract included -- it holds escrow and collateral.
        let market_id = ctx.market.id().clone();
        ctx.register(&market_id).await?;
        let ids: Vec<_> = std::iter::once(ctx.buyer.id().clone())
            .chain(ctx.uw.iter().map(|a| a.id().clone()))
            .chain(std::iter::once(ctx.outsider.id().clone()))
            .collect();
        for id in ids {
            ctx.register(&id).await?;
            ctx.mint(&id, 1_000 * USDC).await?;
        }

        Ok(ctx)
    }

    pub async fn register(&self, account_id: &near_workspaces::AccountId) -> anyhow::Result<()> {
        self.usdc
            .call("storage_deposit")
            .args_json(json!({ "account_id": account_id, "registration_only": true }))
            .deposit(NearToken::from_millinear(10))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn mint(
        &self,
        account_id: &near_workspaces::AccountId,
        amount: u128,
    ) -> anyhow::Result<()> {
        self.usdc
            .call("mint")
            .args_json(json!({ "account_id": account_id, "amount": amount.to_string() }))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn ft_balance(&self, account_id: &near_workspaces::AccountId) -> anyhow::Result<u128> {
        let b: String = self
            .usdc
            .view("ft_balance_of")
            .args_json(json!({ "account_id": account_id }))
            .await?
            .json()?;
        Ok(b.parse()?)
    }

    pub async fn solvency(&self) -> anyhow::Result<Solvency> {
        let v: serde_json::Value = self.market.view("solvency").await?.json()?;
        Ok(Solvency {
            total_free: u128_at(&v, "total_free"),
            total_locked: u128_at(&v, "total_locked"),
            total_escrow: u128_at(&v, "total_escrow"),
            total_bonds: u128_at(&v, "total_bonds"),
            total_claimable: u128_at(&v, "total_claimable"),
            obligations: u128_at(&v, "obligations"),
            tracked_balance: u128_at(&v, "tracked_balance"),
            balanced: v["balanced"].as_bool().unwrap_or(false),
        })
    }

    /// Invariant 1, asserted from outside the contract.
    pub async fn assert_balanced(&self, context: &str) -> anyhow::Result<()> {
        let s = self.solvency().await?;
        assert!(s.balanced, "invariant 1 broken after {context}: {s:?}");
        // And the contract's own bookkeeping must match the token contract's truth.
        let held = self.ft_balance(self.market.id()).await?;
        assert_eq!(
            held, s.tracked_balance,
            "contract's tracked balance disagrees with its real USDC balance after {context}"
        );
        Ok(())
    }

    pub async fn underwriter(
        &self,
        account_id: &near_workspaces::AccountId,
    ) -> anyhow::Result<(u128, u128)> {
        let v: serde_json::Value = self
            .market
            .view("get_underwriter")
            .args_json(json!({ "account_id": account_id }))
            .await?
            .json()?;
        if v.is_null() {
            return Ok((0, 0));
        }
        Ok((u128_at(&v, "free"), u128_at(&v, "locked")))
    }

    /// Sums the payouts of this underwriter's Active policies — the right-hand side of
    /// invariant 2, computed from the policy list rather than from the ledger it checks.
    pub async fn sum_active_payouts(
        &self,
        underwriter: &near_workspaces::AccountId,
    ) -> anyhow::Result<u128> {
        let policies: Vec<serde_json::Value> = self
            .market
            .view("get_policies")
            .args_json(json!({ "limit": 200 }))
            .await?
            .json()?;
        Ok(policies
            .iter()
            .filter(|p| {
                p["underwriter"] == json!(underwriter.to_string()) && p["status"] == json!("Active")
            })
            .map(|p| p["terms"]["payout"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0))
            .sum())
    }

    pub async fn policy(&self, id: u64) -> anyhow::Result<serde_json::Value> {
        Ok(self
            .market
            .view("get_policy")
            .args_json(json!({ "policy_id": id.to_string() }))
            .await?
            .json()?)
    }

    pub async fn round(&self, id: u64) -> anyhow::Result<serde_json::Value> {
        Ok(self
            .market
            .view("get_round")
            .args_json(json!({ "round_id": id.to_string() }))
            .await?
            .json()?)
    }

    // -----------------------------------------------------------------------
    // Actions
    // -----------------------------------------------------------------------

    /// Underwriter capital in.
    pub async fn deposit(&self, who: &Account, amount: u128) -> anyhow::Result<()> {
        who.call(self.usdc.id(), "ft_transfer_call")
            .args_json(json!({
                "receiver_id": self.market.id(),
                "amount": amount.to_string(),
                "msg": "\"Deposit\"",
            }))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    /// Buyer opens a round, escrowing `max_premium`.
    pub async fn request_cover(
        &self,
        who: &Account,
        max_premium: u128,
        terms: serde_json::Value,
    ) -> anyhow::Result<()> {
        let msg = json!({ "RequestCover": { "terms": terms } }).to_string();
        who.call(self.usdc.id(), "ft_transfer_call")
            .args_json(json!({
                "receiver_id": self.market.id(),
                "amount": max_premium.to_string(),
                "msg": msg,
            }))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn commit(
        &self,
        who: &Account,
        round_id: u64,
        premium: u128,
        salt: &str,
    ) -> anyhow::Result<()> {
        let hash = commit_hash(round_id, premium, salt, who.id().as_str());
        who.call(self.market.id(), "commit_bid")
            .args_json(json!({ "round_id": round_id.to_string(), "hash": hash }))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn reveal(
        &self,
        who: &Account,
        round_id: u64,
        premium: u128,
        salt: &str,
    ) -> anyhow::Result<()> {
        who.call(self.market.id(), "reveal_bid")
            .args_json(json!({
                "round_id": round_id.to_string(),
                "premium": premium.to_string(),
                "salt": salt,
            }))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn finalize(&self, who: &Account, round_id: u64) -> anyhow::Result<()> {
        who.call(self.market.id(), "finalize_round")
            .args_json(json!({ "round_id": round_id.to_string() }))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn transfer_policy(
        &self,
        from: &Account,
        to: &near_workspaces::AccountId,
        policy_id: u64,
    ) -> anyhow::Result<()> {
        from.call(self.market.id(), "nft_transfer")
            .args_json(json!({
                "receiver_id": to,
                "token_id": policy_id.to_string(),
            }))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    pub async fn submit_observation(
        &self,
        who: &Account,
        policy_id: u64,
        mm_x10: u32,
        days_valid: u16,
    ) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
        Ok(who
            .call(self.market.id(), "submit_observation")
            .args_json(json!({
                "policy_id": policy_id.to_string(),
                "mm_x10": mm_x10,
                "days_valid": days_valid,
            }))
            .max_gas()
            .transact()
            .await?)
    }

    pub async fn ff(&self, blocks: u64) -> anyhow::Result<()> {
        self.worker.fast_forward(blocks).await?;
        Ok(())
    }

    pub async fn now(&self) -> anyhow::Result<u64> {
        Ok(self.worker.view_block().await?.timestamp() / 1_000_000_000)
    }

    /// Advances the chain until the block clock is past `unix_secs`.
    ///
    /// `fast_forward` moves in whole blocks, so stepping in chunks and checking is the
    /// only way to land reliably on the far side of a deadline without overshooting a
    /// later one.
    pub async fn ff_past(&self, unix_secs: u64) -> anyhow::Result<()> {
        for _ in 0..200 {
            if self.now().await? > unix_secs {
                return Ok(());
            }
            self.worker.fast_forward(FF_CHUNK).await?;
        }
        anyhow::bail!("could not advance the sandbox clock past {unix_secs}")
    }

    /// Steps into the reveal window of a round.
    pub async fn ff_to_reveal(&self, round_id: u64) -> anyhow::Result<()> {
        let r = self.round(round_id).await?;
        let d: u64 = r["commit_deadline"].as_str().unwrap_or("0").parse()?;
        self.ff_past(d).await
    }

    /// Steps past the reveal deadline of a round, so it can be finalized.
    pub async fn ff_past_reveal(&self, round_id: u64) -> anyhow::Result<()> {
        let r = self.round(round_id).await?;
        let d: u64 = r["reveal_deadline"].as_str().unwrap_or("0").parse()?;
        self.ff_past(d).await
    }

    /// Runs a whole round to a minted policy and returns its id.
    pub async fn run_round(
        &self,
        terms: serde_json::Value,
        max_premium: u128,
        bids: &[(usize, u128)],
    ) -> anyhow::Result<u64> {
        self.request_cover(&self.buyer, max_premium, terms).await?;
        let round_id = self.next_round_id().await?;

        for (i, premium) in bids {
            self.commit(&self.uw[*i], round_id, *premium, &salt(*i as u8)).await?;
        }
        self.ff_to_reveal(round_id).await?;
        for (i, premium) in bids {
            self.reveal(&self.uw[*i], round_id, *premium, &salt(*i as u8)).await?;
        }
        self.ff_past_reveal(round_id).await?;
        self.finalize(&self.outsider, round_id).await?;
        Ok(round_id)
    }

    /// The id of the round that was just opened: rounds start at 1 and increment.
    pub async fn next_round_id(&self) -> anyhow::Result<u64> {
        let rounds: Vec<serde_json::Value> = self
            .market
            .view("get_rounds")
            .args_json(json!({ "limit": 200 }))
            .await?
            .json()?;
        Ok(rounds.len() as u64)
    }
}

/// The commit hash from RULES.md §3, computed independently of the contract.
///
/// Deliberately a separate implementation: if the contract's `commit_preimage` and this
/// one ever disagree, every reveal test fails, which is exactly the alarm we want.
pub fn commit_hash(round_id: u64, premium: u128, salt_hex: &str, bidder: &str) -> String {
    let preimage = format!("mmiri:bid:v1:{round_id}:{premium}:{salt_hex}:{bidder}");
    hex::encode(Sha256::digest(preimage.as_bytes()))
}

pub fn salt(n: u8) -> String {
    format!("{:02x}", n).repeat(32)
}

// ---------------------------------------------------------------------------
// Terms used across the suite. Real seasons, real numbers.
// ---------------------------------------------------------------------------

/// Enugu, 30 days from 15 April, 60.0 mm strike, 50 USDC payout.
fn enugu(start: u32) -> serde_json::Value {
    json!({
        "lat_e4": 64500,
        "lon_e4": 75100,
        "start": start,
        "days": 30,
        "strike_mm_x10": 600,
        "payout": PAYOUT.to_string(),
    })
}

/// 2025: the window totalled 53.6 mm, under the 60 mm strike, so this one pays.
pub fn terms_2025_pays() -> serde_json::Value {
    enugu(20250415)
}

/// 2026: the window totalled 113.7 mm, over the strike, so this one expires.
pub fn terms_2026_expires() -> serde_json::Value {
    enugu(20260415)
}

/// A window far enough ahead that settlement must be refused.
pub fn terms_future() -> serde_json::Value {
    enugu(20300415)
}

/// Enugu 2025's real window total, in tenths of a mm. Verified against NASA POWER and
/// recomputed offline from sim/fixtures/rainfall.json.
pub const MM_2025: u32 = 536;
/// Enugu 2026's real window total.
pub const MM_2026: u32 = 1137;
