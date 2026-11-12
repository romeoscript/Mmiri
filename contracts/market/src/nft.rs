//! The policy as an NEP-171 token.
//!
//! The token is the instrument: whoever holds it is owed the payout. There is no
//! separate registry of beneficiaries, which is why `nft_transfer` is a transfer of the
//! money and not just of a label.
//!
//! No NEP-178 approval management, deliberately. A stale approval is the cleanest way
//! for a seller to pull the token back during settlement and take the payout with it, so
//! v1 removes the mechanism rather than guarding it. `approval_id` is accepted on
//! `nft_transfer` for signature compatibility and must be `None`. See THREAT_MODEL.md T2
//! and DECISIONS.md.
//!
//! Enumeration views iterate the policy map with `from_index` / `limit`. Change methods
//! never iterate: a transfer is a single map write, so no amount of policies can make one
//! run out of gas.

use crate::{Contract, ContractExt, Policy, PolicyStatus};
use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::{
    AccountId, Gas, PromiseError, PromiseOrValue, env, ext_contract, near, require,
};

const GAS_NFT_ON_TRANSFER: Gas = Gas::from_tgas(25);
const GAS_NFT_RESOLVE: Gas = Gas::from_tgas(10);

#[ext_contract(ext_nft_receiver)]
#[allow(dead_code)]
pub trait NonFungibleTokenReceiver {
    fn nft_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_id: AccountId,
        token_id: TokenId,
        msg: String,
    ) -> PromiseOrValue<bool>;
}

/// NEP-297 mint event.
pub(crate) fn log_nft_mint(owner_id: &AccountId, token_id: u64) {
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"nep171","version":"1.0.0","event":"nft_mint","data":[{{"owner_id":"{}","token_ids":["{}"]}}]}}"#,
        owner_id, token_id
    ));
}

/// NEP-297 transfer event.
fn log_nft_transfer(old_owner_id: &AccountId, new_owner_id: &AccountId, token_id: u64) {
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"nep171","version":"1.0.0","event":"nft_transfer","data":[{{"old_owner_id":"{}","new_owner_id":"{}","token_ids":["{}"]}}]}}"#,
        old_owner_id, new_owner_id, token_id
    ));
}

fn parse_token_id(token_id: &str) -> u64 {
    token_id
        .parse::<u64>()
        .unwrap_or_else(|_| env::panic_str("token id must be a decimal policy id"))
}

impl Contract {
    pub(crate) fn token_from_policy(&self, p: &Policy) -> Token {
        let status = match p.status {
            PolicyStatus::Active => "active",
            PolicyStatus::PaidOut => "paid out",
            PolicyStatus::Expired => "expired",
        };
        let title = format!("Mmiri rainfall cover #{}", p.id.0);
        let description = format!(
            "Pays {} USDC if rainfall at ({}, {}) over {} days from {} totals less than {} mm. Status: {}.",
            p.terms.payout.0 as f64 / 1_000_000.0,
            p.terms.lat_e4 as f64 / 10_000.0,
            p.terms.lon_e4 as f64 / 10_000.0,
            p.terms.days,
            p.terms.start,
            p.terms.strike_mm_x10 as f64 / 10.0,
            status
        );
        // The full terms travel with the token, so a wallet or indexer can show what the
        // instrument actually promises without calling our views.
        let extra = near_sdk::serde_json::to_string(&p.terms).unwrap_or_default();

        Token {
            token_id: p.id.0.to_string(),
            owner_id: p.owner_id.clone(),
            metadata: Some(TokenMetadata {
                title: Some(title),
                description: Some(description),
                media: None,
                media_hash: None,
                copies: Some(1),
                issued_at: None,
                expires_at: None,
                starts_at: None,
                updated_at: None,
                extra: Some(extra),
                reference: None,
                reference_hash: None,
            }),
            // No approval mechanism exists; see the module comment.
            approved_account_ids: None,
        }
    }

    fn internal_transfer(&mut self, from: &AccountId, to: &AccountId, id: u64) {
        let policy = self
            .policies
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such token"));
        require!(&policy.owner_id == from, "sender is not the token owner");
        require!(from != to, "sender and receiver must differ");

        self.policies.get_mut(&id).unwrap().owner_id = to.clone();
        log_nft_transfer(from, to, id);
    }
}

#[near]
impl Contract {
    // -----------------------------------------------------------------------
    // NEP-171 core
    // -----------------------------------------------------------------------

    /// Transfers the policy, and with it the right to be paid.
    ///
    /// Permitted at any time, including while a settlement is in flight. That is not an
    /// oversight: invariant 4 requires the payout to follow the token, so blocking
    /// transfers during the gap would be the wrong fix for a problem settled elsewhere
    /// (the payout recipient is read at callback time).
    #[payable]
    pub fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        require!(approval_id.is_none(), "this contract has no approval management");
        let sender = env::predecessor_account_id();
        let id = parse_token_id(&token_id);
        self.internal_transfer(&sender, &receiver_id, id);
        if let Some(memo) = memo {
            env::log_str(&format!("memo: {}", memo));
        }
    }

    #[payable]
    pub fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        near_sdk::assert_one_yocto();
        require!(approval_id.is_none(), "this contract has no approval management");
        let sender = env::predecessor_account_id();
        let id = parse_token_id(&token_id);
        self.internal_transfer(&sender, &receiver_id, id);
        if let Some(memo) = memo {
            env::log_str(&format!("memo: {}", memo));
        }

        ext_nft_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_NFT_ON_TRANSFER)
            .nft_on_transfer(sender.clone(), sender.clone(), token_id.clone(), msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_NFT_RESOLVE)
                    .nft_resolve_transfer(sender, receiver_id, token_id, None),
            )
            .into()
    }

    /// Returns the token to the previous owner when the receiver declines it.
    #[private]
    pub fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<std::collections::HashMap<AccountId, u64>>,
        #[callback_result] receiver_result: Result<bool, PromiseError>,
    ) -> bool {
        let _ = approved_account_ids;
        let id = parse_token_id(&token_id);

        // `true` from the receiver means "I am giving it back"; a failed call means the
        // receiver never took it, so the token must go home either way.
        let returned = receiver_result.unwrap_or(true);

        if !returned {
            return true;
        }

        // Only undo if the receiver still holds it; it may have moved on since.
        let still_holds = self
            .policies
            .get(&id)
            .map(|p| p.owner_id == receiver_id)
            .unwrap_or(false);
        if still_holds {
            self.policies.get_mut(&id).unwrap().owner_id = previous_owner_id.clone();
            log_nft_transfer(&receiver_id, &previous_owner_id, id);
        }
        false
    }

    pub fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        let id = token_id.parse::<u64>().ok()?;
        self.policies.get(&id).map(|p| self.token_from_policy(p))
    }

    // -----------------------------------------------------------------------
    // NEP-181 enumeration
    // -----------------------------------------------------------------------

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.policies.len() as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = from_index.map(|v| v.0 as usize).unwrap_or(0);
        let lim = limit.unwrap_or(50) as usize;
        self.policies
            .iter()
            .skip(from)
            .take(lim)
            .map(|(_, p)| self.token_from_policy(p))
            .collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.policies.iter().filter(|(_, p)| p.owner_id == account_id).count() as u128)
    }

    pub fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        let from = from_index.map(|v| v.0 as usize).unwrap_or(0);
        let lim = limit.unwrap_or(50) as usize;
        self.policies
            .iter()
            .filter(|(_, p)| p.owner_id == account_id)
            .skip(from)
            .take(lim)
            .map(|(_, p)| self.token_from_policy(p))
            .collect()
    }

    // -----------------------------------------------------------------------
    // NEP-177 metadata
    // -----------------------------------------------------------------------

    pub fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Mmiri Rainfall Cover".to_string(),
            symbol: "MMIRI".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}
