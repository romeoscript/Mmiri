# The demo video

`mmiri-demo.mp4` — the submission walkthrough, 3:17. It is a recording of the application
itself: a real Chrome driving `web/` against the live testnet deployment, with narration — and
in the middle of it, a full round running on chain, from the request to the payout.

Nothing in it is a mock-up or a slide of a screenshot. Every figure on screen is computed by
the app from the committed rainfall fixture or read from `market.mmiri-demo.testnet` at the
moment of the recording.

## What it shows, in order

| Beat | On screen | The claim |
|---|---|---|
| The farmer | The hero | Assessing a two-hectare farm costs more than the policy is worth |
| 45 seasons of rainfall | The rainfall record chart | 9 of 45 seasons fell below the strike; 6 of the 9 since 2011 |
| Her terms | Place, strike, payout | The buyer sets the terms; the maximum is escrowed with the request |
| Her own wallet | The real wallet-selector modal | Non-custodial; MyNearWallet and Meteor |
| Five sealed bids | The agent quote table | Sealed premiums, lowest wins, full payout locked as collateral; clears at 12.77 USDC |
| Why a market | 20.0% / 40.0% / 2.00× | Two honest rates that disagree by a factor of two |
| Settlement | The testnet cards | 53.6 mm against a 60.0 mm strike — policy 7 by keeper, policy 9 by a TEE worker |
| A round, start to finish | `scripts/demo` in a terminal | Round 11, run on testnet while making this film: five sealed bids, cleared at 9.13 USDC to uw-1, policy minted as an NFT, 15.87 USDC refunded to the buyer, rainfall recomputed at 53.6 mm, **PaidOut**, books balanced |
| 15 seasons backtested | The simulation page | Longrun won most of the market and ended with 103.49 of its 2,000 USDC; Recent is the only agent in profit |
| Live on NEAR testnet | The policies page | Four policies read from the contract — three paid out, one expired |

## How it was made

Reproducible from the repository, with no screen-recording permissions and no paid services:

1. `pnpm build && pnpm start` in `web/`, pointed at testnet by `web/.env.local`.
2. Narration: `npx hyperframes tts` (Kokoro-82M, local, voice `af_heart`, speed 1.05), one clip
   per beat from `narration/s*.txt`; mixed onto one track with the per-beat gaps the film needs.
3. Picture: a headless Chrome at a 1536×864 viewport, driven on the narration's own clock —
   eased scrolls, cursor moves, a real click on the wallet button, real page changes. Frames
   come from CDP's screencast, each carrying its own timestamp, so holds stay held.
4. Shot in four takes — three of the app, one of the terminal — because a single
   two-and-a-half minute session crashed the renderer on the 300-row simulation table. Each
   take is cut to its exact film-time span and they are joined in order, so the narration
   never drifts and any one take can be re-shot on its own.
5. Title cards and section labels are rendered from HTML in the same typeface and palette as
   the product, then composited over the picture in a single ffmpeg pass — one encode, so the
   UI text stays as sharp as it was captured.

The terminal take is a replay, not a re-enactment. `scripts/demo 2025` was run against testnet
while making this film; its stdout is in the capture log, and every line on screen is verbatim
from it — the round id, the five sealed premiums, the clearing line, the NASA figures, the
settled policy. What is cut is near-cli's transaction receipts and the RPC chatter, and every
cut is marked on screen with a dimmed `…`. The waits are real too: the contract's commit and
reveal windows took 51 and 55 seconds, shown as `… 51s later` rather than waited through.

One thing that run exposed: `rpc.testnet.near.org` is deprecated and now rate-limits with
`-429`, which killed the reveal step on the first attempt. `.env` now points `NEAR_RPC_URL` at
`https://test.rpc.fastnear.com` (the previous value is in `.env.bak-rpc`). `web/.env.local`
still points the browser at the old endpoint — worth changing before any live demo.

A caveat worth stating plainly: Chrome's screencast emits CSS pixels, so the footage is
captured at 1536×864 and resampled to 1920×1080 for delivery. The cards and labels are drawn
at native 1920, so the typography is not resampled — but the app pixels are, and at 1.25× that
is visible if you go looking for it. Shooting at a 1920 CSS viewport would have been native,
at the cost of making every figure in the UI a quarter smaller in frame; readability won.

The scripts that do this are in `tools/`, with `tools/README.md` giving the order to run them
in and the two things that will break it. The narration text (`narration/`), the timing plan
(`plan.json`), the overlay and terminal sources (`overlays.html`, `term.html`) and the round's
own log (`round-11.log`) are kept beside them, so the film can be rebuilt, re-cut or
fact-checked without starting over.

## The narration

Full text, one file per beat, in `narration/`. Read in film order: s1, s2, s3, s9, s4, s5, s7,
**s10, s11**, s6, s8 — the settlement beat comes before the backtest because that is the order
the page puts them in, and the walkthrough only ever scrolls forward. `plan.json` holds the
mapping, each clip's measured length and the film-time span of every take.

## Not in this video

- No mainnet. Everything is testnet, and the video says so.
- The keeper path is not called trustless: policy 7 settled by a trusted keeper, policy 9 by a
  TEE worker. Both are shown, labelled differently.
- No claim that rainfall is measured at the farm. One NASA POWER grid cell is about 56 × 69 km
  near Enugu, and the site says so on the page the video scrolls past.
