# Mmiri

> **Status: in development.** Sections marked `TODO(gate-N)` are not yet true and are not claims. Every
> command shown without that marker has been run, and its real output is shown. See `PLAN.md` for scope
> and `docs/DECISIONS.md` for why things are the way they are.

Mmiri is Igbo for water, and the everyday word for rain.

## The problem

A smallholder farmer in south-east Nigeria plants when the rains come in April. If the rain fails, the
crop fails. Insurance against that exists in principle and almost never in practice, for a reason that
has nothing to do with technology: assessing a two-hectare farm costs more than the policy is worth. An
assessor has to travel there, agree what was lost, and file a claim. On a 50 dollar policy, nobody can
afford to.

Index insurance removes the assessor. Instead of asking what *you* lost, it asks what the *rainfall* was,
and pays on a number nobody can argue with. That solves the cost problem and leaves a harder one: **what
is the right price?**

Here is the actual data for Enugu, a 30-day window from 15 April, asking how often the total falls below
60 mm:

- **7 of the 45 seasons from 1981 to 2025** — 15.6%
- **4 of the last 15** — 26.7%

Both numbers are correct. They disagree by a factor of nearly two, and the premium you should charge
differs accordingly. No single formula can know which rate is right, because the question — *how much
does the distant past tell you about next season* — is a genuine open question about a changing climate,
not a calculation anyone has got wrong.

So Mmiri does not pick. It runs a market.

## What Mmiri is

A farmer asks for cover on a place and a window: *pay me 50 USDC if less than 60 mm of rain falls on this
cell in the 30 days from 15 April.* They state the most they will pay and nothing else.

A market of underwriter agents — each with its own NEAR account, its own capital and its own view of the
history — bids sealed premiums for that risk. The lowest bid wins. The winner locks the **full payout** as
collateral, so the promise is funded, not fractional. The policy is minted as an NEP-171 NFT.

When the window closes, a hash-pinned program reads NASA's rainfall record for that cell and reports the
total. If it came in under the strike, the payout goes to **whoever holds the NFT**. Nobody files a claim.

The underwriters that misprice the risk lose their own capital. That is the mechanism: competing models,
real money behind each, and the price of rain risk discovered rather than decreed.

## Try it

TODO(gate-2): install and test steps, once `cargo test` is green and the real output can be pasted here.

TODO(gate-5): `pnpm sim` — one command, no network, no LLM, prints the per-agent table.

TODO(gate-3): the testnet demo — a 2025 Enugu policy that pays its holder and a 2026 one that expires,
with explorer links.

## Where NEAR is used

TODO(gate-4): concrete and checkable — sub-accounts per agent, function-call keys and the exact
`permission` object each one carries, NEP-171, the oracle call, Intents.

## What happens when a policy is transferred

The policy NFT is a bearer instrument: the right to be paid attaches to the token, not to the account
that bought it. A farmer who needs cash before the window closes can sell the cover; a co-operative can
hold policies for its members; a lender can take one as security.

The rule that makes that safe is one line of the contract: **the payout is sent to whoever owns the token
at the moment the oracle result arrives** — not to whoever called `settle`, and not to whoever owned it
when the policy was written.

That distinction is the whole design. `settle` is asynchronous: it fires an off-chain request and the
answer comes back in a later callback. If the contract decided the recipient when `settle` was called, a
seller could call `settle`, sell the policy while the request was in flight, and still collect the money —
leaving the buyer holding a token that had already paid out to someone else. Resolving the owner at
callback time closes that window.

`docs/THREAT_MODEL.md` §1 works through every way a seller could try to keep the money, and
TODO(gate-2): the `transfer_during_settlement` test, which sells the policy inside that gap and asserts
the new holder is paid.

## Honest limits

- **This is not a licensed insurer.** It is a demonstration of a mechanism.
- **Basis risk.** One NASA POWER grid cell is roughly 56 × 69 km near Enugu. Rain measured on the cell is
  not rain that fell on your farm. This is inherent to index insurance, and the honest fix is a denser
  measurement network, not better code.
- **The reading at settlement is final.** NASA revises historical values; a revision after settlement does
  not reopen a settled policy. The alternative — outcomes an outside party can revise after the money
  moved — is worse.
- **Testnet only.** TODO(gate-2): and why.
- TODO(gate-3): the oracle trust model **as actually shipped**, not the better one.

## Disclosures

- **AI assistance.** Built with Claude Code throughout, under my direction, in the
  hackathon window. The design brief, the gate decisions and every approval are mine.
- **My other hackathon entry.** This is one of two independent projects I have submitted. The other is
  **Ileri** — TODO(gate-7): link. The two share no code and live in separate repositories. Disclosed per
  the hackathon's Q-015.
- **Libraries and templates.** TODO(gate-2): complete list with versions.
- **Data.** NASA POWER daily `PRECTOTCORR` (Precipitation Corrected), `community=AG`. No API key required.
  `sim/fixtures/rainfall.json` is a frozen pull — 8 sites, 1981–2026, 22,080 daily values, zero missing —
  and records its own pull date and source URLs. Rebuild it with `node scripts/build-fixture.mjs`.
- **Demo mode.** TODO(gate-2): what it changes and what it cannot change.
- **Baseline code.** None. This repository was empty at the start of the hackathon window; every commit is
  in-window work.

## Repository layout

```
contracts/market/   the auction, escrow, collateral ledger and NEP-171 policies
contracts/usdc/     a stock NEP-141 mock, 6 decimals, for testnet
oracle/             wasm32-wasip2 program: terms on stdin, rainfall total on stdout
agents/             five underwriter agents, the coordinator, and the shared pricing library
sim/                offline simulation and the committed rainfall fixture
web/                Next.js app
scripts/            setup, deploy, demo, verify-oracle, build-fixture
docs/               RULES.md, THREAT_MODEL.md, DECISIONS.md, DEMO.md
```

Two documents were written before any contract code, because both make claims the code then has to honour:

- **`docs/RULES.md`** — the rules of the market. The commit hash, the pricing formula and the rainfall
  total each have exactly one definition there, used by both the Rust contract and the TypeScript agents,
  so the two cannot drift.
- **`docs/THREAT_MODEL.md`** — the transfer threat model, written before the NFT existed.

## License

MIT — see `LICENSE`.
