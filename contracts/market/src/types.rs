use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, near};

/// USDC base units. 1 USDC = 1_000_000.
pub type Usdc = u128;

/// Token id of a policy equals the id of the round that created it.
pub type RoundId = u64;

/// Hard cap on commits in one round.
///
/// Without it a griefer could submit enough bids that `finalize_round` cannot complete
/// inside one transaction's gas, which would freeze the buyer's escrow permanently.
/// See THREAT_MODEL.md T12.
pub const MAX_COMMITS_PER_ROUND: u32 = 32;

/// Every policy we sell. Longer windows would need a fixture pull with more days.
pub const EXPECTED_DAYS: u16 = 30;

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

/// Identifies a risk completely. Integers only: a float that rounded differently in
/// Rust and in JavaScript would make the contract and the agents disagree about who
/// owes what. See RULES.md §1.
#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Terms {
    /// Latitude in degrees x 10,000. Enugu = 64500.
    pub lat_e4: i32,
    /// Longitude in degrees x 10,000. Enugu = 75100.
    pub lon_e4: i32,
    /// First day of the window, YYYYMMDD.
    pub start: u32,
    /// Window length in days. 30 for every policy we sell.
    pub days: u16,
    /// Strike in tenths of a mm. 60.0 mm = 600.
    pub strike_mm_x10: u32,
    /// Payout in USDC base units.
    pub payout: U128,
}

impl Terms {
    pub fn assert_valid(&self) {
        near_sdk::require!(self.days == EXPECTED_DAYS, "days must be 30");
        near_sdk::require!(self.payout.0 > 0, "payout must be positive");
        near_sdk::require!(self.strike_mm_x10 > 0, "strike must be positive");
        near_sdk::require!(
            self.lat_e4 >= -900_000 && self.lat_e4 <= 900_000,
            "latitude out of range"
        );
        near_sdk::require!(
            self.lon_e4 >= -1_800_000 && self.lon_e4 <= 1_800_000,
            "longitude out of range"
        );
        // Parsed rather than trusted: an unparseable date would make the window
        // boundaries meaningless and invariants 3 and 6 unenforceable.
        let _ = crate::dates::start_unix(self.start);
    }

    /// Unix seconds at 00:00 UTC on the first day of the window.
    pub fn start_unix(&self) -> i64 {
        crate::dates::start_unix(self.start)
    }

    /// Unix seconds at the instant the window closes (exclusive end of the last day).
    pub fn window_end_unix(&self) -> i64 {
        self.start_unix() + (self.days as i64) * 86_400
    }

    /// The grid cell this risk sits in, used for the concentration check in the
    /// agents. Rounded to NASA POWER's half-degree grid.
    pub fn cell(&self) -> (i32, i32) {
        (self.lat_e4.div_euclid(5_000), self.lon_e4.div_euclid(5_000))
    }
}

// ---------------------------------------------------------------------------
// Underwriter
// ---------------------------------------------------------------------------

/// Two buckets, as specified: capital that can be committed, and capital standing
/// behind live policies. Bonds are tracked on the round, not here.
#[near(serializers = [json, borsh])]
#[derive(Clone, Default, Debug)]
pub struct Underwriter {
    pub free: U128,
    pub locked: U128,
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RoundPhase {
    /// Accepting sealed commits.
    Commit,
    /// Accepting reveals of existing commits.
    Reveal,
    /// Finalized with a winner; a policy exists.
    Settled,
    /// Finalized with no valid bid; the buyer was refunded in full.
    Refunded,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Commit {
    pub bidder: AccountId,
    /// sha256 of the canonical preimage in RULES.md §3.
    pub hash: Vec<u8>,
    /// Bond held at commit, returned on reveal, forfeited to the buyer otherwise.
    pub bond: U128,
    /// Position in the round, used to break premium ties deterministically.
    pub seq: u32,
    /// `None` until revealed.
    pub revealed_premium: Option<U128>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Round {
    pub id: U64,
    pub buyer: AccountId,
    pub terms: Terms,
    /// The most the buyer will pay, held in escrow.
    pub max_premium: U128,
    /// Unix seconds.
    pub commit_deadline: U64,
    pub reveal_deadline: U64,
    pub phase: RoundPhase,
    pub commits: Vec<Commit>,
    /// Set once finalized with a winner.
    pub winner: Option<AccountId>,
    pub clearing_premium: Option<U128>,
}

impl Round {
    pub fn commit_of(&self, bidder: &AccountId) -> Option<&Commit> {
        self.commits.iter().find(|c| &c.bidder == bidder)
    }
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PolicyStatus {
    /// Live. Collateral locked, outcome unknown.
    Active,
    /// Rainfall came in under the strike and the holder was paid.
    PaidOut,
    /// Rainfall met or exceeded the strike; collateral released.
    Expired,
}

/// How a reading reached the contract. Stated on the policy so a reader can tell what
/// they are trusting without reading the README. See THREAT_MODEL.md T16, T17.
#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum OracleSource {
    /// Hash-pinned WASM executed in OutLayer's TEE. Carries the execution reference.
    OutLayer { execution_ref: String },
    /// Posted by the trusted keeper account. Verifiable after the fact with
    /// scripts/verify-oracle, but not prevented.
    Keeper { account_id: AccountId },
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Reading {
    /// Window total in tenths of a mm.
    pub mm_x10: u32,
    /// Days in the window that were not NASA's fill value. Must equal `terms.days`.
    pub days_valid: u16,
    pub source: OracleSource,
    /// Block timestamp of the callback, nanoseconds.
    pub observed_at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Policy {
    /// Equals the round id and the NFT token id.
    pub id: U64,
    /// Current holder. This is the NEP-171 owner, and the only thing that decides who
    /// a payout goes to. Read at oracle-callback time, never cached at `settle`.
    /// See THREAT_MODEL.md T1.
    pub owner_id: AccountId,
    pub underwriter: AccountId,
    pub terms: Terms,
    /// What the buyer actually paid.
    pub premium: U128,
    pub status: PolicyStatus,
    pub reading: Option<Reading>,
    /// Set before the cross-contract oracle call and cleared on failure, so a second
    /// `settle` cannot run concurrently. See THREAT_MODEL.md T3.
    pub settling: bool,
}

impl Policy {
    /// Unix seconds from which `settle` is permitted.
    pub fn settle_allowed_at(&self, settle_delay_days: u16) -> i64 {
        self.terms.window_end_unix() + (settle_delay_days as i64) * 86_400
    }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner_id: AccountId,
    pub usdc_account: AccountId,
    pub outlayer_account: AccountId,
    /// Keeper permitted to call `submit_observation`. Only meaningful in keeper mode.
    pub keeper_account: AccountId,
    /// Published oracle WASM and its sha256. The contract pins the hash so a worker
    /// cannot substitute different code.
    pub oracle_wasm_url: String,
    pub oracle_wasm_sha256: String,
    pub commit_seconds: u32,
    pub reveal_seconds: u32,
    /// Days after the window closes before settlement is allowed. 4, because NASA's
    /// near-real-time lag is 3 and a failed OutLayer run is not refunded.
    pub settle_delay_days: u16,
    /// Bond held per commit, forfeited to the buyer on non-reveal.
    pub bid_bond: U128,
    /// Permits rounds on windows that have already started, so a real season can be
    /// replayed before the hackathon deadline. Relaxes invariant 6 and nothing else.
    pub demo_mode: bool,
}

/// What the contract is holding and on whose behalf. Invariant 1 says the USDC balance
/// equals the sum of these. Exposed as a view so the property can be checked from
/// outside, not only in tests.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Solvency {
    pub total_free: U128,
    pub total_locked: U128,
    pub total_escrow: U128,
    pub total_bonds: U128,
    pub total_claimable: U128,
    /// The sum of the five above: what the contract owes.
    pub obligations: U128,
    /// What the contract believes it holds, from its own bookkeeping.
    pub tracked_balance: U128,
    /// True when they agree. A false here is a bug, not a market condition.
    pub balanced: bool,
}
