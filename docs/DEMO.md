# Mmiri — the 100-second demo

A script for the demo video. The aim is one complete moment: a real user action through to a
visible result, with NEAR's part in it said concretely rather than vaguely.

Lead with the farmer's problem, not the architecture. Nobody watching needs to know what
NEP-171 is until after they care.

---

## Before you record

```bash
pnpm install
rustup target add wasm32-unknown-unknown wasm32-wasip2
./scripts/test          # ~3 min, leave it finished on screen
pnpm sim                # leave the table in the scrollback
cd web && pnpm install && pnpm dev
```

Open two things: a terminal, and `http://localhost:3000`.

If a testnet deployment exists by then, run `./scripts/demo` once beforehand so there is a
settled policy to show. If not, say so in the video — the simulation and the sandbox tests
carry the argument on their own, and claiming a deployment that does not exist is the one
thing that would actually sink the submission.

---

## The script

### 0:00 – 0:15 · The problem

> A farmer in south-east Nigeria plants when the rains come in April. If the rain fails, the
> crop fails. Crop insurance exists, but nobody will sell it to her — assessing a two-hectare
> farm costs more than a fifty dollar policy is worth.

*On screen: the home page of the web app, Enugu selected.*

### 0:15 – 0:35 · Why this needs a market

> Index insurance fixes the cost problem: don't ask what she lost, ask what the rainfall was.
> But then you have to price it. Here is the same place, the same window, two honest answers.

*Point at the two stat tiles: 15.6% across all 45 seasons, 26.7% across the last fifteen.*

> Both are correct. They disagree by a factor of two. No formula knows which is right, because
> nobody knows how much the distant past tells you about a changing climate.
>
> So Mmiri doesn't pick. It runs an auction.

### 0:35 – 0:55 · The auction

*Scroll to the five agent quotes.*

> Five underwriters, each a NEAR account with its own capital and its own read of the history.
> They bid sealed premiums — the contract only ever sees a hash until the reveal, so nobody can
> undercut a rival by a cent. Lowest bid wins and locks the **full payout** as collateral. The
> policy is minted as an NFT.

*Point at the spread between cheapest and dearest.*

> That spread is the price of the disagreement.

### 0:55 – 1:20 · Who was right

*Switch to the Simulation page, or the `pnpm sim` output in the terminal.*

> Fifteen seasons of real Nigerian rainfall, eight sites, three hundred rounds. The agent that
> priced on all forty-five years quoted lowest, won eighty percent of the market — and lost
> nineteen hundred of its two thousand dollars. The one that trusted only recent seasons is the
> only one that made money.
>
> Nobody told them the climate is drying. The rainfall did, and the ones that wouldn't listen
> paid for it out of their own capital. That's the whole mechanism.

### 1:20 – 1:35 · Settlement, and the NFT that matters

*Policy page, or `pnpm verify-oracle --lat 6.45 --lon 7.51 --start 20250415 --days 30`.*

> When the window closes, a hash-pinned program reads NASA's rainfall record. 53.6 millimetres
> against a 60 millimetre strike, so this one pays — and it pays **whoever holds the token at
> that moment**, not whoever bought it. The farmer can sell her cover before the window closes
> and the money follows the token. There's a test that sells a policy mid-settlement to prove
> it.
>
> Nobody files a claim. Settlement is a function anyone can call.

### 1:35 – 1:40 · Close

> Contracts, the market, the agents and the simulation are all in the repo, and the tests run
> from a clean clone. Link below.

---

## If you have longer than 100 seconds

Worth showing, in this order:

1. **`./scripts/print-key-permissions`** — the agents hold function-call keys scoped to the
   market and to the two bid methods. Not `withdraw`. A stolen agent key can bid badly; it
   cannot take the capital out. This is a checkable claim, not a slide.
2. **The Intents panel** — a real `dry: true` quote, 20 USDC on Base to USDC on NEAR, with a
   signed quote and every status the swap can reach.
3. **`docs/THREAT_MODEL.md` §1** — written before the NFT existed, working through every way a
   seller could try to keep the money after selling the policy.

## Things not to say

- Do not say it is deployed if it is not.
- Do not call the keeper path trustless. In keeper mode the keeper is trusted completely, and
  `verify-oracle` makes a bad reading detectable rather than impossible.
- Do not imply the rainfall measurement is farm-level. One grid cell is about 56 by 69 km, and
  that basis risk is real.

## The X post

Required: the project was built at NEAR HACKATHON, tagging `@NEARProtocol` and
`#NEARHackathon`, with the video attached. `@NearLegion` and `@NearBuilders` are optional.

Draft — edit freely, and post it yourself:

> Smallholder farmers can't buy rainfall insurance because assessing a two-hectare farm costs
> more than the policy is worth.
>
> Mmiri removes the assessor and auctions the risk instead. Five underwriter agents on NEAR
> sub-accounts bid sealed premiums; the winner locks the full payout as collateral; NASA's
> rainfall record settles it; the policy is an NFT that carries the money, so selling the
> cover sells the payout.
>
> Backtested on 15 seasons of Nigerian rainfall, the agent pricing on the whole 45-year record
> won 80% of the market and lost most of its capital. The one that trusted recent seasons made
> money. Nobody told them the climate is drying — the rainfall did.
>
> Built at NEAR HACKATHON. @NEARProtocol #NEARHackathon
>
> Repo: <repository link>
