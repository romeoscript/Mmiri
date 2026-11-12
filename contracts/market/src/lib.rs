//! Mmiri — a sealed-bid market for rainfall cover.
//!
//! One contract holds the auction, the escrow, the underwriters' collateral ledger and
//! the NEP-171 policies, because all four touch the same money and splitting them would
//! mean a cross-contract call in the middle of every accounting change.
//!
//! The rules this implements are written down in `docs/RULES.md`, and the attacks it
//! defends against in `docs/THREAT_MODEL.md`. Where this code and RULES.md disagree,
//! this code is wrong.
//!
//! Accounting shape: every USDC base unit the contract holds sits in exactly one of five
//! buckets — an underwriter's `free`, an underwriter's `locked`, a round's `escrow`, a
//! round's held `bonds`, or an account's `claimable`. `solvency()` adds them up and
//! compares against what the contract thinks it holds. That is invariant 1, and it is a
//! view so it can be checked from outside rather than only in tests.

mod bid;
mod cover;
mod dates;
mod nft;
mod settle;
mod types;

pub use types::*;

use near_sdk::json_types::{U64, U128};
use near_sdk::store::IterableMap;
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, env,
    ext_contract, near, require,
};

/// Attached to every outgoing `ft_transfer`, as NEP-141 requires.
pub(crate) const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// Enough for a NEP-141 transfer plus its own resolve.
pub(crate) const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
/// Our own resolve callback: bookkeeping only.
pub(crate) const GAS_RESOLVE: Gas = Gas::from_tgas(10);

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Underwriters,
    Rounds,
    Policies,
    Claimable,
}

/// Why a USDC transfer was sent, so one resolve callback can restore the right
/// bookkeeping when it fails. Money owed is never dropped: every failure path either
/// returns the amount to where it came from or records it as claimable.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub enum TransferPurpose {
    /// Unspent escrow plus forfeited bonds going back to the buyer.
    BuyerRefund { round_id: U64, account_id: AccountId },
    /// An underwriter taking out free balance.
    Withdraw { account_id: AccountId },
    /// A payout to the holder of a policy.
    Payout { policy_id: U64, account_id: AccountId },
    /// A previously failed payout, claimed.
    Claim { account_id: AccountId },
}

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub(crate) config: Config,

    pub(crate) underwriters: IterableMap<AccountId, Underwriter>,
    pub(crate) rounds: IterableMap<RoundId, Round>,
    pub(crate) policies: IterableMap<RoundId, Policy>,
    pub(crate) claimable: IterableMap<AccountId, U128>,

    pub(crate) next_round_id: RoundId,

    // ---- accounting totals, maintained on every move ----
    pub(crate) total_free: Usdc,
    pub(crate) total_locked: Usdc,
    pub(crate) total_escrow: Usdc,
    pub(crate) total_bonds: Usdc,
    pub(crate) total_claimable: Usdc,
    /// USDC received minus USDC successfully sent. Invariant 1 compares this against
    /// the sum of the five buckets.
    pub(crate) usdc_balance: Usdc,
}

#[near]
impl Contract {
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        owner_id: AccountId,
        usdc_account: AccountId,
        outlayer_account: AccountId,
        keeper_account: AccountId,
        oracle_wasm_url: String,
        oracle_wasm_sha256: String,
        commit_seconds: u32,
        reveal_seconds: u32,
        settle_delay_days: u16,
        bid_bond: U128,
        demo_mode: bool,
    ) -> Self {
        require!(commit_seconds > 0 && reveal_seconds > 0, "deadlines must be positive");
        Self {
            config: Config {
                owner_id,
                usdc_account,
                outlayer_account,
                keeper_account,
                oracle_wasm_url,
                oracle_wasm_sha256,
                commit_seconds,
                reveal_seconds,
                settle_delay_days,
                bid_bond,
                demo_mode,
            },
            underwriters: IterableMap::new(StorageKey::Underwriters),
            rounds: IterableMap::new(StorageKey::Rounds),
            policies: IterableMap::new(StorageKey::Policies),
            claimable: IterableMap::new(StorageKey::Claimable),
            next_round_id: 1,
            total_free: 0,
            total_locked: 0,
            total_escrow: 0,
            total_bonds: 0,
            total_claimable: 0,
            usdc_balance: 0,
        }
    }

    // -----------------------------------------------------------------------
    // Underwriter capital
    // -----------------------------------------------------------------------

    /// Take free balance out of the market.
    ///
    /// Deliberately absent from the function-call keys the agents hold: a stolen agent
    /// key can place bad bids but cannot remove capital. See THREAT_MODEL.md T15.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let account_id = env::predecessor_account_id();
        require!(amount.0 > 0, "amount must be positive");
        let mut uw = self.underwriters.get(&account_id).cloned().unwrap_or_default();
        require!(uw.free.0 >= amount.0, "insufficient free balance");

        // Debit before the call, restore in the resolve if it fails.
        uw.free = U128(uw.free.0 - amount.0);
        self.total_free -= amount.0;
        self.underwriters.insert(account_id.clone(), uw);

        self.send_usdc(
            account_id.clone(),
            amount,
            "mmiri withdraw",
            TransferPurpose::Withdraw { account_id },
        )
    }

    /// Collect a payout whose transfer failed earlier — most often because the holder
    /// had no storage deposit on the USDC contract. See THREAT_MODEL.md T4.
    pub fn claim_payout(&mut self) -> Promise {
        let account_id = env::predecessor_account_id();
        let amount = self.claimable.get(&account_id).cloned().unwrap_or(U128(0));
        require!(amount.0 > 0, "nothing claimable");

        self.claimable.insert(account_id.clone(), U128(0));
        self.total_claimable -= amount.0;

        self.send_usdc(
            account_id.clone(),
            amount,
            "mmiri claim",
            TransferPurpose::Claim { account_id },
        )
    }

    // -----------------------------------------------------------------------
    // Outgoing USDC and its one resolve
    // -----------------------------------------------------------------------

    pub(crate) fn send_usdc(
        &mut self,
        to: AccountId,
        amount: U128,
        memo: &str,
        purpose: TransferPurpose,
    ) -> Promise {
        ext_ft::ext(self.config.usdc_account.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to, amount, Some(memo.to_string()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_RESOLVE)
                    .on_usdc_sent(amount, purpose),
            )
    }

    /// Restores bookkeeping when an outgoing transfer fails.
    ///
    /// The contract debits before it calls, so a failure here has to put the amount
    /// back somewhere. Nothing is ever simply forgotten — that would break invariant 1
    /// and quietly keep someone's money.
    #[private]
    pub fn on_usdc_sent(
        &mut self,
        amount: U128,
        purpose: TransferPurpose,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            self.usdc_balance -= amount.0;
            return true;
        }

        match purpose {
            TransferPurpose::Withdraw { account_id } => {
                let mut uw = self.underwriters.get(&account_id).cloned().unwrap_or_default();
                uw.free = U128(uw.free.0 + amount.0);
                self.total_free += amount.0;
                self.underwriters.insert(account_id, uw);
                env::log_str("withdraw transfer failed; free balance restored");
            }
            TransferPurpose::BuyerRefund { account_id, .. }
            | TransferPurpose::Payout { account_id, .. }
            | TransferPurpose::Claim { account_id } => {
                self.credit_claimable(&account_id, amount.0);
                env::log_str("transfer failed; amount recorded as claimable");
            }
        }
        false
    }

    pub(crate) fn credit_claimable(&mut self, account_id: &AccountId, amount: Usdc) {
        let current = self.claimable.get(account_id).cloned().unwrap_or(U128(0));
        self.claimable.insert(account_id.clone(), U128(current.0 + amount));
        self.total_claimable += amount;
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    /// Demo mode permits rounds on windows that have already started. Exposed so a
    /// reader never has to take the README's word for it. See RULES.md §9.
    pub fn is_demo_mode(&self) -> bool {
        self.config.demo_mode
    }

    pub fn get_underwriter(&self, account_id: AccountId) -> Option<Underwriter> {
        self.underwriters.get(&account_id).cloned()
    }

    pub fn get_underwriters(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<(AccountId, Underwriter)> {
        let from = from_index.unwrap_or(0) as usize;
        let lim = limit.unwrap_or(50) as usize;
        self.underwriters
            .iter()
            .skip(from)
            .take(lim)
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    pub fn get_round(&self, round_id: U64) -> Option<Round> {
        self.rounds.get(&round_id.0).cloned()
    }

    pub fn get_rounds(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Round> {
        let from = from_index.unwrap_or(0) as usize;
        let lim = limit.unwrap_or(50) as usize;
        self.rounds.iter().skip(from).take(lim).map(|(_, v)| v.clone()).collect()
    }

    pub fn get_policy(&self, policy_id: U64) -> Option<Policy> {
        self.policies.get(&policy_id.0).cloned()
    }

    pub fn get_policies(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Policy> {
        let from = from_index.unwrap_or(0) as usize;
        let lim = limit.unwrap_or(50) as usize;
        self.policies.iter().skip(from).take(lim).map(|(_, v)| v.clone()).collect()
    }

    pub fn get_claimable(&self, account_id: AccountId) -> U128 {
        self.claimable.get(&account_id).cloned().unwrap_or(U128(0))
    }

    /// Invariant 1, as a view.
    ///
    /// `balanced == false` is a bug in this contract, not a market condition. Tests
    /// assert it after every money-moving path.
    pub fn solvency(&self) -> Solvency {
        let obligations = self.total_free
            + self.total_locked
            + self.total_escrow
            + self.total_bonds
            + self.total_claimable;
        Solvency {
            total_free: U128(self.total_free),
            total_locked: U128(self.total_locked),
            total_escrow: U128(self.total_escrow),
            total_bonds: U128(self.total_bonds),
            total_claimable: U128(self.total_claimable),
            obligations: U128(obligations),
            tracked_balance: U128(self.usdc_balance),
            balanced: obligations == self.usdc_balance,
        }
    }
}
