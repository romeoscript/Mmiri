//! Does the sandbox start and do both contracts deploy and initialise?
//!
//! Kept separate from the invariant suite so a failure here is unambiguous: it means the
//! environment is wrong, not that the contract is.

mod common;

#[tokio::test]
async fn sandbox_starts_and_contracts_deploy() -> anyhow::Result<()> {
    let ctx = common::Ctx::new().await?;

    let usdc_meta: serde_json::Value =
        ctx.usdc.view("ft_metadata").await?.json()?;
    assert_eq!(usdc_meta["decimals"], 6, "mock USDC must have 6 decimals");
    assert_eq!(usdc_meta["symbol"], "USDC");

    let cfg: serde_json::Value = ctx.market.view("get_config").await?.json()?;
    assert_eq!(cfg["usdc_account"], serde_json::json!(ctx.usdc.id().to_string()));

    let demo: bool = ctx.market.view("is_demo_mode").await?.json()?;
    assert!(demo, "the test fixture runs in demo mode so past windows can be used");

    // Nothing has moved yet, so the books balance trivially -- but the view must exist
    // and agree, because every later test leans on it.
    let s = ctx.solvency().await?;
    assert!(s.balanced, "solvency must balance on a fresh contract: {s:?}");
    assert_eq!(s.obligations, 0);

    let supply: String = ctx.market.view("nft_total_supply").await?.json()?;
    assert_eq!(supply, "0");

    Ok(())
}
