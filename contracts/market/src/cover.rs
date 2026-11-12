//! The only way USDC enters the contract: NEP-141 `ft_on_transfer`.
//!
//! Underwriters deposit capital and buyers open rounds through the same entry point,
//! distinguished by the `msg`. Doing it this way means a buyer's escrow and an
//! underwriter's capital arrive already transferred, so there is no window in which the
//! contract has promised something it has not been paid for.

use crate::dates::now_unix;
use crate::{Contract, ContractExt, Round, RoundPhase, Terms, Usdc};
use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, PromiseOrValue, env, near, require, serde_json};

/// What the sender wants done with the USDC they just transferred.
///
/// `"Deposit"` or `{"RequestCover":{"terms":{...}}}`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub enum TransferMessage {
    /// Add to the sender's free balance as an underwriter.
    Deposit,
    /// Escrow the amount as the most the sender will pay, and open a round.
    RequestCover { terms: Terms },
}

#[near]
impl Contract {
    /// NEP-141 receiver hook. Returns the number of base units to refund, always 0:
    /// either the whole amount is accepted or the call panics and the token contract
    /// returns everything.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        // The most important line in the contract. Without it anyone could call
        // ft_on_transfer directly and credit themselves a balance they never funded,
        // then be paid real premiums out of other people's capital.
        // See THREAT_MODEL.md T13.
        require!(
            env::predecessor_account_id() == self.config.usdc_account,
            "only the configured USDC contract may call ft_on_transfer"
        );
        require!(amount.0 > 0, "amount must be positive");

        let parsed: TransferMessage = serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str("msg must be \"Deposit\" or {\"RequestCover\":{...}}"));

        match parsed {
            TransferMessage::Deposit => self.handle_deposit(sender_id, amount.0),
            TransferMessage::RequestCover { terms } => {
                self.handle_request_cover(sender_id, amount.0, terms)
            }
        }

        PromiseOrValue::Value(U128(0))
    }

    fn handle_deposit(&mut self, sender_id: AccountId, amount: Usdc) {
        let mut uw = self.underwriters.get(&sender_id).cloned().unwrap_or_default();
        uw.free = U128(uw.free.0 + amount);
        self.underwriters.insert(sender_id.clone(), uw);
        self.total_free += amount;
        self.usdc_balance += amount;
        env::log_str(&format!("deposit {} by {}", amount, sender_id));
    }

    fn handle_request_cover(&mut self, buyer: AccountId, amount: Usdc, terms: Terms) {
        terms.assert_valid();

        // Invariant 6: no hindsight. A round on a window that has already begun lets a
        // buyer shop for cover on rain they have already seen. Demo mode relaxes this
        // and nothing else, so a real season can be replayed before the deadline.
        if !self.config.demo_mode {
            require!(
                terms.start_unix() > now_unix(),
                "window has already started; only demo mode allows past windows"
            );
        }

        let round_id = self.next_round_id;
        self.next_round_id += 1;

        let now = now_unix();
        let commit_deadline = now + self.config.commit_seconds as i64;
        let reveal_deadline = commit_deadline + self.config.reveal_seconds as i64;

        let round = Round {
            id: U64(round_id),
            buyer: buyer.clone(),
            terms,
            max_premium: U128(amount),
            commit_deadline: U64(commit_deadline as u64),
            reveal_deadline: U64(reveal_deadline as u64),
            phase: RoundPhase::Commit,
            commits: Vec::new(),
            winner: None,
            clearing_premium: None,
        };

        self.rounds.insert(round_id, round);
        self.total_escrow += amount;
        self.usdc_balance += amount;

        env::log_str(&format!(
            "round {} opened by {} with max premium {}; commits close at {}, reveals at {}",
            round_id, buyer, amount, commit_deadline, reveal_deadline
        ));
    }
}
