//! The sealed-bid auction: commit, reveal, finalize.
//!
//! The commit hash is defined in RULES.md §3 and computed in exactly one place here, by
//! `commit_preimage`, so the Rust and TypeScript sides cannot drift apart.

use crate::dates::now_unix;
use crate::{
    Commit, Contract, ContractExt, Policy, PolicyStatus, RoundPhase, TransferPurpose, Usdc,
};
use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, Promise, env, near, require};

/// The canonical preimage from RULES.md §3.
///
/// `:` cannot occur inside any field — NEAR account ids are `[a-z0-9._-]`, and the other
/// three are decimal or lowercase hex — so the encoding is injective and no two distinct
/// bids can collide.
pub fn commit_preimage(round_id: u64, premium: Usdc, salt_hex: &str, bidder: &AccountId) -> String {
    format!("mmiri:bid:v1:{}:{}:{}:{}", round_id, premium, salt_hex, bidder)
}

fn assert_salt(salt_hex: &str) {
    require!(salt_hex.len() == 64, "salt must be 32 bytes as 64 hex characters");
    require!(
        salt_hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "salt must be lowercase hex"
    );
}

#[near]
impl Contract {
    /// Place a sealed bid. The premium is not revealed, and cannot be inferred: 32 bytes
    /// of salt make the hash information-free.
    ///
    /// Requires free balance of at least payout + bond, and holds the bond.
    pub fn commit_bid(&mut self, round_id: U64, hash: String) {
        let bidder = env::predecessor_account_id();
        let round_id = round_id.0;

        let hash_bytes = hex::decode(&hash)
            .unwrap_or_else(|_| env::panic_str("hash must be hex"));
        require!(hash_bytes.len() == 32, "hash must be 32 bytes");

        let round = self
            .rounds
            .get(&round_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such round"));

        require!(
            matches!(round.phase, RoundPhase::Commit),
            "round is not accepting commits"
        );
        require!(now_unix() < round.commit_deadline.0 as i64, "commit window has closed");
        require!(round.buyer != bidder, "a buyer cannot underwrite its own round");
        require!(round.commit_of(&bidder).is_none(), "already committed to this round");
        // Bounded so finalize_round can always complete. See THREAT_MODEL.md T12.
        require!(
            (round.commits.len() as u32) < crate::MAX_COMMITS_PER_ROUND,
            "this round has reached its commit limit"
        );

        let payout = round.terms.payout.0;
        let bond = self.config.bid_bond.0;
        let mut uw = self.underwriters.get(&bidder).cloned().unwrap_or_default();
        require!(
            uw.free.0 >= payout.saturating_add(bond),
            "insufficient free balance to cover payout plus bond"
        );

        // Only the bond moves now. The payout is locked at finalize, and the winner is
        // re-checked for funds then. See RULES.md §9 and THREAT_MODEL.md T11.
        uw.free = U128(uw.free.0 - bond);
        self.underwriters.insert(bidder.clone(), uw);
        self.total_free -= bond;
        self.total_bonds += bond;

        let seq = round.commits.len() as u32;
        let round = self.rounds.get_mut(&round_id).unwrap();
        round.commits.push(Commit {
            bidder: bidder.clone(),
            hash: hash_bytes,
            bond: U128(bond),
            seq,
            revealed_premium: None,
        });

        env::log_str(&format!("round {} commit {} from {}", round_id, seq, bidder));
    }

    /// Open a sealed bid. The hash is recomputed and must match, so a bid can never be
    /// revealed at a premium other than the one committed (invariant 5).
    pub fn reveal_bid(&mut self, round_id: U64, premium: U128, salt: String) {
        let bidder = env::predecessor_account_id();
        let round_id = round_id.0;
        assert_salt(&salt);

        let round = self
            .rounds
            .get(&round_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such round"));
        let now = now_unix();
        require!(now >= round.commit_deadline.0 as i64, "reveal window has not opened");
        require!(now < round.reveal_deadline.0 as i64, "reveal window has closed");
        require!(
            matches!(round.phase, RoundPhase::Commit | RoundPhase::Reveal),
            "round is already finalized"
        );

        let idx = round
            .commits
            .iter()
            .position(|c| c.bidder == bidder)
            .unwrap_or_else(|| env::panic_str("no commit from this account"));
        require!(round.commits[idx].revealed_premium.is_none(), "already revealed");

        let expected = &round.commits[idx].hash;
        let actual = env::sha256(commit_preimage(round_id, premium.0, &salt, &bidder).as_bytes());
        require!(&actual == expected, "reveal does not match the committed hash");

        let bond = round.commits[idx].bond.0;

        {
            let round = self.rounds.get_mut(&round_id).unwrap();
            round.commits[idx].revealed_premium = Some(premium);
            round.phase = RoundPhase::Reveal;
        }

        // The bond did its job; give it back.
        let mut uw = self.underwriters.get(&bidder).cloned().unwrap_or_default();
        uw.free = U128(uw.free.0 + bond);
        self.underwriters.insert(bidder.clone(), uw);
        self.total_bonds -= bond;
        self.total_free += bond;

        env::log_str(&format!("round {} reveal {} from {}", round_id, premium.0, bidder));
    }

    /// Close the round and write the policy. Callable by anyone once reveals have closed.
    ///
    /// Lowest revealed premium at or under the buyer's maximum wins; ties break on the
    /// earliest commit. A winner who can no longer cover the payout is skipped rather
    /// than allowed to win uncollateralised, which is what keeps invariant 2 true.
    pub fn finalize_round(&mut self, round_id: U64) -> Promise {
        let round_id = round_id.0;
        let round = self
            .rounds
            .get(&round_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such round"));
        require!(
            matches!(round.phase, RoundPhase::Commit | RoundPhase::Reveal),
            "round is already finalized"
        );
        require!(
            now_unix() >= round.reveal_deadline.0 as i64,
            "reveal window has not closed"
        );

        let payout = round.terms.payout.0;
        let max_premium = round.max_premium.0;

        // Bonds of those who never revealed go to the buyer, who lost the round to
        // their silence. See THREAT_MODEL.md T9.
        let forfeited: Usdc = round
            .commits
            .iter()
            .filter(|c| c.revealed_premium.is_none())
            .map(|c| c.bond.0)
            .sum();

        // Ordered candidates: premium ascending, then earliest commit.
        let mut candidates: Vec<(Usdc, u32, AccountId)> = round
            .commits
            .iter()
            .filter_map(|c| {
                c.revealed_premium
                    .filter(|p| p.0 <= max_premium)
                    .map(|p| (p.0, c.seq, c.bidder.clone()))
            })
            .collect();
        candidates.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));

        let winner = candidates.into_iter().find(|(_, _, who)| {
            self.underwriters.get(who).map(|uw| uw.free.0 >= payout).unwrap_or(false)
        });

        self.total_bonds -= forfeited;
        self.total_escrow -= max_premium;

        let refund = match winner {
            Some((premium, _, who)) => {
                let mut uw = self.underwriters.get(&who).cloned().unwrap_or_default();
                uw.free = U128(uw.free.0 - payout + premium);
                uw.locked = U128(uw.locked.0 + payout);
                self.underwriters.insert(who.clone(), uw);
                self.total_free = self.total_free - payout + premium;
                self.total_locked += payout;

                self.policies.insert(
                    round_id,
                    Policy {
                        id: U64(round_id),
                        owner_id: round.buyer.clone(),
                        underwriter: who.clone(),
                        terms: round.terms.clone(),
                        premium: U128(premium),
                        status: PolicyStatus::Active,
                        reading: None,
                        settling: false,
                    },
                );

                {
                    let r = self.rounds.get_mut(&round_id).unwrap();
                    r.phase = RoundPhase::Settled;
                    r.winner = Some(who.clone());
                    r.clearing_premium = Some(U128(premium));
                }

                crate::nft::log_nft_mint(&round.buyer, round_id);
                env::log_str(&format!(
                    "round {} cleared at {} to {}; policy {} minted to {}",
                    round_id, premium, who, round_id, round.buyer
                ));
                max_premium - premium + forfeited
            }
            None => {
                let r = self.rounds.get_mut(&round_id).unwrap();
                r.phase = RoundPhase::Refunded;
                env::log_str(&format!(
                    "round {} had no fundable bid at or under {}; buyer refunded in full",
                    round_id, max_premium
                ));
                max_premium + forfeited
            }
        };

        self.send_usdc(
            round.buyer.clone(),
            U128(refund),
            "mmiri round refund",
            TransferPurpose::BuyerRefund {
                round_id: U64(round_id),
                account_id: round.buyer,
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::commit_preimage;

    #[test]
    fn preimage_is_stable_and_domain_separated() {
        let bidder: near_sdk::AccountId = "uw-3.mmiri.testnet".parse().unwrap();
        let salt = "a".repeat(64);
        let p = commit_preimage(7, 12_500_000, &salt, &bidder);
        assert_eq!(
            p,
            format!("mmiri:bid:v1:7:12500000:{}:uw-3.mmiri.testnet", salt)
        );
    }

    #[test]
    fn different_bidders_hash_differently() {
        // Why `bidder` is in the preimage: otherwise a watcher could lift a commit off
        // the chain and reveal it as their own. See THREAT_MODEL.md T8.
        let a: near_sdk::AccountId = "uw-1.mmiri.testnet".parse().unwrap();
        let b: near_sdk::AccountId = "uw-2.mmiri.testnet".parse().unwrap();
        let salt = "0".repeat(64);
        assert_ne!(
            commit_preimage(1, 100, &salt, &a),
            commit_preimage(1, 100, &salt, &b)
        );
    }

    #[test]
    fn different_rounds_hash_differently() {
        let a: near_sdk::AccountId = "uw-1.mmiri.testnet".parse().unwrap();
        let salt = "0".repeat(64);
        assert_ne!(
            commit_preimage(1, 100, &salt, &a),
            commit_preimage(2, 100, &salt, &a)
        );
    }
}
