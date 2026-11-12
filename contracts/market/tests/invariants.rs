//! The six invariants from RULES.md §9, one test each, plus the threat-model cases
//! those invariants depend on.
//!
//! Each test is written so that it fails if the invariant breaks — not merely so that it
//! passes today. Where that distinction matters, a comment says what wrong
//! implementation the test is there to catch.

mod common;

use common::*;
use serde_json::json;

// ---------------------------------------------------------------------------
// Invariant 1 — conservation
// ---------------------------------------------------------------------------

/// USDC held equals free + locked + escrow + bonds + claimable, at every step of a
/// complete lifecycle.
///
/// Catches: any path that creates or destroys value — a premium credited without
/// debiting escrow, a bond returned twice, a payout that leaves the collateral locked.
#[tokio::test]
async fn invariant_1_conservation_holds_through_a_full_lifecycle() -> anyhow::Result<()> {
    let ctx = Ctx::new().await?;
    ctx.assert_balanced("deploy").await?;

    for i in 0..3 {
        ctx.deposit(&ctx.uw[i], 200 * USDC).await?;
        ctx.assert_balanced(&format!("deposit by uw-{}", i + 1)).await?;
    }

    ctx.request_cover(&ctx.buyer, 20 * USDC, terms_2025_pays()).await?;
    let round = ctx.next_round_id().await?;
    ctx.assert_balanced("request_cover").await?;

    ctx.commit(&ctx.uw[0], round, 15 * USDC, &salt(0)).await?;
    ctx.commit(&ctx.uw[1], round, 11 * USDC, &salt(1)).await?;
    // uw-3 commits and then stays silent, so its bond is forfeited at finalize.
    ctx.commit(&ctx.uw[2], round, 9 * USDC, &salt(2)).await?;
    ctx.assert_balanced("three commits").await?;

    ctx.ff_to_reveal(round).await?;
    ctx.reveal(&ctx.uw[0], round, 15 * USDC, &salt(0)).await?;
    ctx.reveal(&ctx.uw[1], round, 11 * USDC, &salt(1)).await?;
    ctx.assert_balanced("two reveals").await?;

    ctx.ff_past_reveal(round).await?;
    ctx.finalize(&ctx.outsider, round).await?;
    ctx.assert_balanced("finalize").await?;

    // uw-2 bid lowest of those that revealed, so it carries the risk.
    let p = ctx.policy(round).await?;
    assert_eq!(p["underwriter"], json!(ctx.uw[1].id().to_string()));
    assert_eq!(p["premium"], json!((11 * USDC).to_string()));

    ctx.submit_observation(&ctx.keeper, round, MM_2025, 30).await?.into_result()?;
    ctx.assert_balanced("settlement with payout").await?;

    ctx.uw[1]
        .call(ctx.market.id(), "withdraw")
        .args_json(json!({ "amount": (10 * USDC).to_string() }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    ctx.assert_balanced("withdraw").await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Invariant 2 — collateral
// ---------------------------------------------------------------------------

/// An underwriter's locked balance equals the total payout of its Active policies.
///
/// Catches: collateral released while a policy is still live, or locked twice for one
/// policy. Checked with two live policies on one underwriter, then after one settles.
#[tokio::test]
async fn invariant_2_locked_equals_active_payouts() -> anyhow::Result<()> {
    let ctx = Ctx::new().await?;
    ctx.deposit(&ctx.uw[0], 300 * USDC).await?;

    // uw-1 is the only bidder, so it wins both.
    let a = ctx.run_round(terms_2025_pays(), 20 * USDC, &[(0, 12 * USDC)]).await?;
    let b = ctx.run_round(terms_2026_expires(), 20 * USDC, &[(0, 12 * USDC)]).await?;

    let (_, locked) = ctx.underwriter(ctx.uw[0].id()).await?;
    assert_eq!(locked, 2 * PAYOUT, "two active policies must lock two payouts");
    assert_eq!(locked, ctx.sum_active_payouts(ctx.uw[0].id()).await?);
    ctx.assert_balanced("two active policies").await?;

    // 2025 came in under the strike: that collateral leaves as a payout.
    ctx.submit_observation(&ctx.keeper, a, MM_2025, 30).await?.into_result()?;
    let (_, locked) = ctx.underwriter(ctx.uw[0].id()).await?;
    assert_eq!(locked, PAYOUT, "one policy remains active");
    assert_eq!(locked, ctx.sum_active_payouts(ctx.uw[0].id()).await?);

    // 2026 came in over the strike: that collateral returns to free.
    let (free_before, _) = ctx.underwriter(ctx.uw[0].id()).await?;
    ctx.submit_observation(&ctx.keeper, b, MM_2026, 30).await?.into_result()?;
    let (free_after, locked) = ctx.underwriter(ctx.uw[0].id()).await?;
    assert_eq!(locked, 0, "no active policies left");
    assert_eq!(
        free_after,
        free_before + PAYOUT,
        "an expired policy must return its collateral to free balance"
    );
    ctx.assert_balanced("both settled").await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Invariant 3 — at most once, never early
// ---------------------------------------------------------------------------

/// A policy pays at most once, and never before window end plus the settle delay.
///
/// Catches: a missing terminal status guard (double payout) and a missing timing guard
/// (settling a window that has not finished, where missing days would read as drought).
#[tokio::test]
async fn invariant_3_pays_at_most_once_and_never_early() -> anyhow::Result<()> {
    let ctx = Ctx::new().await?;
    ctx.deposit(&ctx.uw[0], 300 * USDC).await?;

    // A window in 2030 has not happened yet. Demo mode allows the round to open; it
    // must not allow settlement.
    let future = ctx.run_round(terms_future(), 20 * USDC, &[(0, 12 * USDC)]).await?;
    let early = ctx.submit_observation(&ctx.keeper, future, 100, 30).await?;
    assert!(
        early.is_failure(),
        "settling a window that has not finished must be rejected"
    );
    let p = ctx.policy(future).await?;
    assert_eq!(p["status"], json!("Active"), "a rejected settle must leave the policy active");
    ctx.assert_balanced("rejected early settle").await?;

    // Now a window that is genuinely over.
    let past = ctx.run_round(terms_2025_pays(), 20 * USDC, &[(0, 12 * USDC)]).await?;
    let holder_before = ctx.ft_balance(ctx.buyer.id()).await?;
    ctx.submit_observation(&ctx.keeper, past, MM_2025, 30).await?.into_result()?;
    let holder_after = ctx.ft_balance(ctx.buyer.id()).await?;
    assert_eq!(holder_after, holder_before + PAYOUT, "the holder is paid once");

    // Second attempt must be refused outright.
    let again = ctx.submit_observation(&ctx.keeper, past, MM_2025, 30).await?;
    assert!(again.is_failure(), "a settled policy must not settle again");
    assert_eq!(
        ctx.ft_balance(ctx.buyer.id()).await?,
        holder_after,
        "no second payout may be made"
    );
    ctx.assert_balanced("double settle attempt").await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Invariant 4 — the holder is paid
// ---------------------------------------------------------------------------

/// The payout goes to whoever owns the token when the reading is applied, not to the
/// account that bought the policy.
///
/// Catches: a contract that pays `policy.buyer`, or that caches a recipient anywhere.
#[tokio::test]
async fn invariant_4_payout_follows_the_token() -> anyhow::Result<()> {
    let ctx = Ctx::new().await?;
    ctx.deposit(&ctx.uw[0], 300 * USDC).await?;
    let id = ctx.run_round(terms_2025_pays(), 20 * USDC, &[(0, 12 * USDC)]).await?;

    // The farmer sells the cover on to someone else before it settles.
    ctx.transfer_policy(&ctx.buyer, ctx.outsider.id(), id).await?;
    let token: serde_json::Value = ctx
        .market
        .view("nft_token")
        .args_json(json!({ "token_id": id.to_string() }))
        .await?
        .json()?;
    assert_eq!(token["owner_id"], json!(ctx.outsider.id().to_string()));

    let buyer_before = ctx.ft_balance(ctx.buyer.id()).await?;
    let new_holder_before = ctx.ft_balance(ctx.outsider.id()).await?;

    ctx.submit_observation(&ctx.keeper, id, MM_2025, 30).await?.into_result()?;

    assert_eq!(
        ctx.ft_balance(ctx.outsider.id()).await?,
        new_holder_before + PAYOUT,
        "the current holder must be paid"
    );
    assert_eq!(
        ctx.ft_balance(ctx.buyer.id()).await?,
        buyer_before,
        "the original buyer must receive nothing after selling"
    );
    ctx.assert_balanced("payout after transfer").await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Invariant 5 — sealed means sealed
// ---------------------------------------------------------------------------

/// A bid cannot be revealed at any premium other than the one committed.
///
/// Catches: a reveal that stores the submitted premium without recomputing the hash —
/// which would let an underwriter see the competition and then raise its own price.
#[tokio::test]
async fn invariant_5_reveal_must_match_the_commitment() -> anyhow::Result<()> {
    let ctx = Ctx::new().await?;
    ctx.deposit(&ctx.uw[0], 300 * USDC).await?;
    ctx.request_cover(&ctx.buyer, 20 * USDC, terms_2025_pays()).await?;
    let round = ctx.next_round_id().await?;

    ctx.commit(&ctx.uw[0], round, 12 * USDC, &salt(0)).await?;
    ctx.ff_to_reveal(round).await?;

    // Same salt, different premium.
    let wrong_premium = ctx.reveal(&ctx.uw[0], round, 5 * USDC, &salt(0)).await;
    assert!(wrong_premium.is_err(), "a different premium must not reveal");

    // Right premium, different salt.
    let wrong_salt = ctx.reveal(&ctx.uw[0], round, 12 * USDC, &salt(9)).await;
    assert!(wrong_salt.is_err(), "a different salt must not reveal");

    // The honest reveal still works, so the failures above were the hash check and not
    // some unrelated breakage.
    ctx.reveal(&ctx.uw[0], round, 12 * USDC, &salt(0)).await?;
    let r = ctx.round(round).await?;
    assert_eq!(r["commits"][0]["revealed_premium"], json!((12 * USDC).to_string()));
    ctx.assert_balanced("reveal attempts").await?;

    Ok(())
}

/// A commit hash is only valid for the account that made it.
///
/// Catches: leaving the bidder out of the preimage, which would let a watcher lift a
/// sealed bid off the chain and reveal it as their own. THREAT_MODEL T8.
#[tokio::test]
async fn commit_hashes_are_bound_to_their_bidder() -> anyhow::Result<()> {
    let ctx = Ctx::new().await?;
    ctx.deposit(&ctx.uw[0], 300 * USDC).await?;
    ctx.deposit(&ctx.uw[1], 300 * USDC).await?;
    ctx.request_cover(&ctx.buyer, 20 * USDC, terms_2025_pays()).await?;
    let round = ctx.next_round_id().await?;

    // uw-2 commits a hash computed for uw-1, as if it had copied it off the chain.
    let stolen = commit_hash(round, 12 * USDC, &salt(0), ctx.uw[0].id().as_str());
    ctx.uw[1]
        .call(ctx.market.id(), "commit_bid")
        .args_json(json!({ "round_id": round.to_string(), "hash": stolen }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    ctx.ff_to_reveal(round).await?;
    // uw-2 cannot open it, because the preimage names uw-1.
    let r = ctx.reveal(&ctx.uw[1], round, 12 * USDC, &salt(0)).await;
    assert!(r.is_err(), "a hash made for another account must not reveal");

    Ok(())
}

// ---------------------------------------------------------------------------
// Invariant 6 — no hindsight
// ---------------------------------------------------------------------------

/// Outside demo mode a round cannot open for a window that has already started.
///
/// Catches: the absence of the demo-mode guard, which would let a buyer shop for cover
/// on rain they have already watched fall.
#[tokio::test]
async fn invariant_6_no_rounds_on_windows_already_started() -> anyhow::Result<()> {
    let ctx = Ctx::new_strict().await?;
    assert!(!ctx.market.view("is_demo_mode").await?.json::<bool>()?);

    let before = ctx.ft_balance(ctx.buyer.id()).await?;
    // 2025 is in the past. A strict deployment must refuse it.
    //
    // Note what is being asserted and why. `ft_transfer_call` is specified to swallow a
    // receiver's panic and refund the sender, so the buyer's transaction still succeeds
    // -- the refusal shows up as "no round exists and the money came back", which is
    // the property that actually matters.
    ctx.request_cover(&ctx.buyer, 20 * USDC, terms_2025_pays()).await?;

    assert_eq!(ctx.next_round_id().await?, 0, "no round may have been created");
    assert_eq!(
        ctx.ft_balance(ctx.buyer.id()).await?,
        before,
        "a refused round must return the escrow attempt in full"
    );
    ctx.assert_balanced("refused past window").await?;

    // A future window is fine even in strict mode.
    ctx.request_cover(&ctx.buyer, 20 * USDC, terms_future()).await?;
    assert_eq!(ctx.next_round_id().await?, 1);

    Ok(())
}
