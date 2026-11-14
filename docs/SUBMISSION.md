# Submission pack

Everything a submission form asks for, written out so it can be pasted rather than composed
under time pressure. Every claim here is checkable from the repository or from chain.

> **The `website` field is a spam trap. Leave it empty.** Any non-empty value rejects the
> submission (hackathon rules, read 2026-11-12).

## Links

| Field | Value |
|---|---|
| Repository | https://github.com/romeoscript/Mmiri |
| Live app | https://mmiri-nu.vercel.app |
| Demo video (3:17) | https://github.com/romeoscript/Mmiri/blob/main/demo-output/mmiri-demo.mp4 |
| X post | https://x.com/romeoscript1/status/2121722462182523201 |
| Market contract | `market.mmiri-demo.testnet` ([explorer](https://testnet.nearblocks.io/address/market.mmiri-demo.testnet)) |
| USDC (test) | `usdc.mmiri-demo.testnet` |
| Network | NEAR testnet |

## Name

Mmiri — Igbo for water, and for rain.

## One line

A sealed-bid market where underwriter agents compete to price drought cover for smallholder
farmers, settled from NASA's rainfall record.

## Tracks

All four track prompts are addressed by the same system; claim whichever the form allows.

- **`swarms`** — five autonomous underwriter agents, each a NEAR sub-account with its own
  capital, its own function-call key scoped to two methods, and its own read of the rainfall
  history. They compete; the market, not a human, sets the price.
- **`nfts`** — the policy is a NEP-171 token. The payout follows the token, so cover can be
  sold before the window closes. `docs/THREAT_MODEL.md` §1 works through every way a seller
  could try to keep the money after selling.
- **`realworld`** — rainfall index insurance for Nigerian smallholders, settled from NASA
  POWER's public record.
- **`defi`** — a sealed-bid commit–reveal auction with full collateralisation; the winner
  locks the entire payout, and the contract's books are checked by an invariant test.

## Description

Smallholder farmers cannot buy drought cover, because assessing a two-hectare farm costs more
than a fifty dollar policy is worth. Index insurance removes the assessor: do not ask what she
lost, ask what the rainfall was. But then someone has to price it, and the honest answers
disagree — across the whole 45-year record at Enugu the strike is breached one season in five;
across the last fifteen, two in five. No formula knows which rate next season will obey.

Mmiri does not pick. It runs an auction. A buyer posts terms and the most they will pay, which
is escrowed. Five underwriter agents each submit a sealed bid — the contract stores a hash, not
a price — and after the commit window closes they reveal. The lowest bid at or under the
buyer's maximum wins, locks the full payout as collateral, and the policy is minted as an NFT;
the difference between the maximum and the winning bid is refunded. When the window ends, the
rainfall is recomputed from NASA POWER by a hash-pinned program and reported on chain, and the
contract pays whoever holds the token at that moment. Nobody files a claim.

The mechanism is tested where it matters: in a 15-season backtest over eight sites and 300
rounds, the agent that priced on all 45 years quoted lowest, won most of the market, and ended
with 103.49 of its 2,000 USDC. The one that trusted only recent seasons is the only agent that
made money. Nobody told these agents the climate is drying — the rainfall did, through their
balance sheets.

## What is actually deployed

Round 11 was opened, bid, revealed, finalised and settled on testnet while the demo was being
recorded; `demo-output/round-11.log` is its full output. Four policies exist: 6, 7 and 9 paid
out, 8 expired. Policy 9 was settled by an OutLayer worker running the oracle inside a TEE
rather than by a trusted account.

## What this does not claim

- Testnet only. No mainnet deployment, and the video says so.
- The keeper path is trusted, and is labelled as such wherever it appears. `pnpm verify-oracle`
  makes a bad reading detectable, not impossible.
- Rainfall is a grid cell roughly 56 × 69 km near Enugu, not the farm. That basis risk is
  inherent to index insurance and is stated on the page itself.
- The live NEAR Intents path is not exercised: quotes are real, deposits are not submitted.

## Reproducing it

```bash
pnpm install
rustup target add wasm32-unknown-unknown wasm32-wasip2
./scripts/test     # contracts, invariants, the NFT transfer-mid-settlement case
pnpm sim           # the 15-season backtest, byte-identical on the same seed
```
