# Mmiri

Mmiri is Igbo for water, and the everyday word for rain.

It is rainfall insurance for smallholder farmers, where the price is set by a market of
competing underwriters rather than by a formula, and settlement comes from a public
rainfall record rather than from an assessor.

Built for the NEAR Hackathon, 2026.

---

## The problem

A farmer in south-east Nigeria plants when the rains come in April. If the rain fails, the
crop fails. Insurance against that exists in principle and almost never in practice, for a
reason that has nothing to do with technology: assessing a two-hectare farm costs more than
the policy is worth. Someone has to travel there, agree what was lost, and process a claim.
On a fifty dollar policy, nobody can afford to.

Index insurance removes the assessor. Instead of asking what *you* lost, it asks what the
*rainfall* was, and pays on a number nobody can argue with. That solves the cost problem and
leaves a harder one: **what is the right price?**

Here is the actual data for Enugu, a 30-day window from 15 April, asking how often the total
falls below 60 mm:

- **7 of the 45 seasons from 1981 to 2025** — 15.6%
- **4 of the last 15** — 26.7%

Both numbers are correct. They disagree by nearly a factor of two, and the premium you
should charge differs accordingly. No single formula can know which is right, because the
question behind it — how much does the distant past tell you about next season — is a real
open question about a changing climate, not a sum anyone has got wrong.

So Mmiri does not pick. It runs an auction.

## What it does

A farmer asks for cover on one place and one window: *pay me 50 USDC if less than 60 mm of
rain falls on this cell in the 30 days from 15 April.* They state the most they will pay and
nothing else.

Five underwriter agents — each with its own NEAR account, its own capital, and its own read
of the history — bid sealed premiums. The lowest bid wins and locks the **full payout** as
collateral, so the promise is funded rather than fractional. The policy is minted as an
NEP-171 token.

When the window closes, a hash-pinned program reads NASA's rainfall record for that cell and
reports the total. If it came in under the strike, the payout goes to **whoever holds the
token**. Nobody files a claim.

Underwriters that misprice the risk lose their own capital. That is the mechanism, and the
simulation below shows it happening.

---

## Try it

Everything in this section has been run, and the output shown is real. Steps 1–5 need no
keys, no wallet and no network beyond installing dependencies.

### 0. What you need

- Rust 1.95+ with two wasm targets
- Node 22+ and pnpm

```bash
rustup target add wasm32-unknown-unknown wasm32-wasip2
pnpm install
```

### 1. Run the tests — see 71 pass

```bash
./scripts/test
```

Builds both contracts, then runs three suites:

```
==> unit tests          12 passed    contract logic: commit preimage, calendar edges, oracle parsing
==> oracle tests         8 passed    the rainfall algorithm, including the Enugu 2025 tie case
==> integration tests    8 passed    the six invariants, in a real NEAR sandbox
```

and `pnpm test` adds 43 more in TypeScript. The integration suite takes about two and a half
minutes because each test starts its own sandbox node and they run one at a time — in
parallel they contend and go flaky, and a suite that fails one run in three is worse than a
slow one.

The six invariants are stated in `docs/RULES.md` §9 and each has a test written to fail if
the invariant breaks, not merely to pass today:

| | Invariant | What the test does |
|---|---|---|
| 1 | USDC held equals free + locked + escrow + bonds + claimable | Checks the books after every step of a full lifecycle, against the token contract's own view |
| 2 | Locked collateral equals the payouts of active policies | Two live policies on one underwriter, then after one pays and one expires |
| 3 | A policy pays at most once, never early | Settling an unfinished 2030 window is refused; a second settle moves no money |
| 4 | The payout goes to the holder at callback time | Sells the policy before settlement; asserts the **new** holder is paid and the buyer gets nothing |
| 5 | A bid cannot be revealed at another premium | Wrong premium and wrong salt both rejected, then the honest reveal accepted |
| 6 | Outside demo mode, no round on a window already started | Refused, and the escrow attempt comes back in full |

### 2. Run the market against fifteen years of real rainfall

```bash
pnpm sim
```

No network, no keys, no LLM. 20 buyers, 5 underwriters, 8 Nigerian sites, seasons 2011–2025,
fixed seed. Output:

```
  agent            won  bid  decl   premiums     claims    loss    capital     profit
  -----------------------------------------------------------------------------------
  uw-1 Longrun     241  267    33    3033.49    4930.00    163%     103.49   -1896.51
  uw-2 Recent       35  300     0     326.15     160.00     49%    2166.15     166.15
  uw-3 Blend         2  300     0      43.25     130.00    301%    1913.25     -86.75
  uw-4 Cautious      0  300     0       0.00       0.00     n/a    2000.00       0.00
  uw-5 Capacity     20  300     0     369.46     420.00    114%    1949.46     -50.54
  -----------------------------------------------------------------------------------
  300 rounds · 298 cleared · 2 found no bid · 111 paid out (37% of cleared)
```

Longrun prices on all 45 seasons, so it quotes lowest, wins 80% of the market, and pays 163%
of its premiums out in claims — down from 2000 USDC to 103. Recent, which trusts only the
last fifteen seasons, is the only agent that made money. Cautious wins nothing and keeps its
capital, which is exactly what "survive first, compete second" buys.

Nobody told these agents the climate is drying. The rainfall did, and the ones that would not
listen lost their own capital.

Run it twice and the output is byte-identical; a test asserts that.

### 3. Check a settlement against the public record

```bash
pnpm verify-oracle --lat 6.45 --lon 7.51 --start 20250415 --days 30
```

Fetches NASA POWER, prints every daily value and the URL it used, and recomputes the total:

```
Recomputed total   53.6 mm   (mm_x10 = 536)
Days counted       30 of 30
```

With `--policy <id>` it also reads the reading stored on chain and compares, exiting
non-zero on a mismatch. This is what makes a dishonest settlement *detectable by anyone* —
which is not the same as impossible, and the script says so.

### 4. Open the web app

```bash
cd web && pnpm install && pnpm dev
```

Five pages, no wallet needed for any of them: request cover (rainfall history with the strike
line, and what all five agents would quote for your terms right now), rounds and underwriters,
policies, the simulation, and the Intents panel. With no contract configured it renders from
the committed fixture and says so plainly rather than looking broken.

### 5. Get a real cross-chain quote

The **Pay from any chain** page asks the live 1Click API for a `dry: true` quote — real
routing, real fees, a real ed25519 signature over the terms, and nothing moves. A quote taken
while writing this:

```
20.000000 USDC on base  ->  19.992701 USDC on near
0.036% round trip · 35s estimated · signature ed25519:3RKHqZ...
```

### 6. Build the oracle

```bash
./scripts/build-oracle
```

Produces a 344,805-byte `wasm32-wasip2` component and prints its sha256, which is what the
contract pins so a worker cannot substitute different code. Publish the file somewhere
OutLayer can fetch over https — this repository uses a release asset — then point the
contract at it:

```bash
near contract call-function as-transaction $MMIRI_MARKET set_oracle_wasm \
  json-args "{\"url\":\"$ORACLE_WASM_URL\",\"sha256\":\"$ORACLE_WASM_SHA256\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as $MMIRI_PARENT network-config testnet sign-with-keychain send
```

Until both are set, `settle` refuses and the deployment settles through the keeper instead.

### 7. Deploy to testnet

```bash
cp .env.example .env     # set MMIRI_PARENT to a testnet account you control
./scripts/setup          # creates sub-accounts, deploys both contracts
./scripts/setup-agents   # creates the five underwriters and their scoped keys
./scripts/print-key-permissions
./scripts/demo           # one full round, about three minutes
```

These scripts have been run, and the deployment they produced is live on NEAR testnet:

| | Account |
|---|---|
| Market | [`market.mmiri-demo.testnet`](https://testnet.nearblocks.io/address/market.mmiri-demo.testnet) |
| Mock USDC | [`usdc.mmiri-demo.testnet`](https://testnet.nearblocks.io/address/usdc.mmiri-demo.testnet) |
| Keeper | [`keeper.mmiri-demo.testnet`](https://testnet.nearblocks.io/address/keeper.mmiri-demo.testnet) |
| Underwriters | `uw-1` … `uw-5.mmiri-demo.testnet` |

Three rounds have completed end to end, covering both outcomes and both oracle paths:

- **Policy 7 — paid out, keeper path.** Enugu, 30 days from 15 April 2025. Five agents
  committed sealed bids, all five revealed, `uw-1` won at **9.13 USDC**, the keeper posted
  **53.6 mm** against the 60 mm strike, and the 50 USDC payout went to the holder. `PaidOut`.
- **Policy 8 — expired, keeper path.** The same terms for 2026, which totalled **113.7 mm**.
  No payout, and the underwriter's collateral was unlocked. `Expired`.
- **Policy 9 — paid out, OutLayer path.** The 2025 terms again, settled by `settle` rather
  than `submit_observation`. An OutLayer worker fetched the pinned oracle binary, checked its
  sha256, compiled it, ran it in the TEE and reached NASA: **345,888 instructions, 1,098 ms**,
  `success: true`. It returned **53.6 mm** — the same figure the keeper posted and the same
  figure `pnpm verify-oracle` recomputes locally. The reading is recorded on chain with
  `source: OutLayer`. Cost **0.0012646 NEAR**, with 0.0087354 of the attached 0.01 refunded.

All three readings reproduce from the public record with `pnpm verify-oracle`, and
`./scripts/print-key-permissions` reads the agents' key restrictions back off the chain.

The oracle binary those workers fetch is published as a release asset, and the contract pins
its hash, so "did the right code run" is a checkable fact rather than a promise:

```
https://github.com/romeoscript/Mmiri/releases/download/oracle-v0.1.0/mmiri-oracle.wasm
sha256 7c4a42c8a508969d4bb6760bd5ba7f9d348e3226a3e701d9f550fcf80b8ab326
```

---

## Where NEAR is used

Concretely, not decoratively.

**Sub-accounts, one per agent.** `uw-1.<parent>.testnet` through `uw-5`, plus `keeper`,
`market` and `usdc`. Every bid on chain traces to a specific agent, and the capital behind
each one is its own.

**Function-call access keys, and the thing they cannot do.** Each agent signs with a key
scoped to the market contract and to `commit_bid` and `reveal_bid` — *not* `withdraw`. A
function-call key cannot attach NEAR, cannot transfer, and cannot add further keys, so an
account holding only one of these cannot move its own balance. A stolen agent key can place
bad bids; it cannot take the capital out.

That constraint shaped the setup. A function-call key cannot attach the 1 yoctoNEAR that
`ft_transfer_call` requires, so an agent holding only one can never deposit its own capital.
The accounts are therefore created, funded, and made to deposit while they still have a
full-access key — and then that key is **deleted**. The full-access key exists for the
minutes `scripts/setup-agents` runs under your hand, and never in anything long-lived.
`scripts/print-key-permissions` reads the end state back off the chain so you can check it
instead of believing it.

**NEP-171.** The policy is the token. See the next section.

**NEP-141.** USDC enters the contract exactly one way, through `ft_on_transfer`, with the
message deciding whether it is an underwriter's capital or a buyer's escrow. The single most
important line in the contract asserts the caller is the configured USDC account — without
it, anyone could credit themselves a balance they never funded.

**Cross-contract calls for settlement.** `settle` calls OutLayer's `request_execution` and
handles the result in a callback, the ordinary NEAR promise pattern.

**NEAR Intents.** 1Click quotes for paying a premium from another chain and taking a payout
out to one.

## What happens when a policy is transferred

The policy is a bearer instrument: the right to be paid attaches to the token, not to the
account that bought it. A farmer who needs cash before the window closes can sell the cover;
a co-operative can hold policies for its members; a lender can take one as security.

The rule that makes that safe is one line of the contract: **the payout is sent to whoever
owns the token at the moment the oracle result arrives** — not to whoever called `settle`,
and not to whoever owned it when the policy was written.

That distinction is the whole design. `settle` is asynchronous: it fires an off-chain request
and the answer comes back in a later callback. If the contract decided the recipient when
`settle` was called, a seller could settle, sell the policy while the request was in flight,
and still collect — leaving the buyer holding a token that had already paid out to someone
else. Resolving the owner at callback time closes that window, and
`invariant_4_payout_follows_the_token` sells a policy and asserts the new holder is paid.

This version implements NEP-171 core, enumeration and metadata, and deliberately **no**
NEP-178 approval management. A stale approval is the cleanest way for a seller to pull a
token back mid-settlement, so the mechanism is removed rather than guarded. It costs
marketplace listings, which this demo does not need.

`docs/THREAT_MODEL.md` §1 works through every way a seller could try to keep the money.

---

## How it is put together

```
contracts/market/   the auction, escrow, collateral ledger and NEP-171 policies
contracts/usdc/     a stock NEP-141 mock, 6 decimals, for testnet
oracle/             wasm32-wasip2 component: terms on stdin, rainfall total on stdout
agents/             the five underwriters, the commit hash, and the shared pricing library
sim/                offline simulation and the committed rainfall fixture
web/                Next.js app
scripts/            setup, deploy, demo, verify-oracle, build-oracle, test
docs/               RULES.md, THREAT_MODEL.md, DECISIONS.md, DEMO.md
```

Two documents were written **before** any contract code, because both make claims the code
then has to honour:

- **`docs/RULES.md`** — the rules of the market, with a text sequence diagram of one round.
  The commit hash, the pricing formula and the rainfall total each have exactly one
  definition there, used by both the Rust contract and the TypeScript agents, so the two
  cannot drift.
- **`docs/THREAT_MODEL.md`** — the transfer threat model, written before the NFT existed.
  19 threats with mitigations and named tests, plus 7 risks accepted rather than solved.

`docs/DECISIONS.md` records every non-obvious choice and why.

### Things worth knowing about the code

- **Money is integers everywhere**, in both languages. A float that rounded differently in
  Rust and JavaScript would make the contract and the agents disagree about who owes what.
- **The rainfall total rounds once, at the end, half away from zero.** Thirty per-day
  roundings drift by up to 1.5 mm, which is enough to flip a settlement near the strike. The
  tie case is real rather than hypothetical: Enugu 2025 sums to exactly 535.5 tenths.
- **The pricing rate is Laplace-smoothed `(k+1)/(n+2)`, not raw `k/n`.** At 45 observations
  the difference moves a quote from 9.33 to 10.21 USDC, and a strike that has never been
  breached gets a small positive rate rather than a free policy.
- **No change method iterates an unbounded collection.** Commits per round are capped at 32,
  because an unbounded `finalize_round` would let a griefer freeze a buyer's escrow forever.
- **`panic = "abort"` is deliberately absent** from the release profile, on the reasoning that
  near-sdk reports failures through a std panic hook that `abort` would bypass. **On testnet
  that is not enough:** every `require!` and every `env::panic_str` in this build still
  reaches the caller as a bare "unreachable opcode" with no message — confirmed on the
  deployed contract, and on the USDC contract's own standard-library panics too. The contract
  behaves correctly; it just cannot explain itself. Diagnosing a failed call therefore means
  reading `gas_profile` to see how far execution got, or adding temporary `env::log_str`
  breadcrumbs, because logs do survive. Worth fixing before anyone relies on the messages.

---

## Honest limits

- **This is not a licensed insurer.** It is a demonstration of a mechanism.
- **Basis risk.** One NASA POWER grid cell is roughly 56 × 69 km near Enugu. Rain measured on
  the cell is not rain that fell on your farm. This is inherent to index insurance; the honest
  fix is a denser measurement network, not better code.
- **The reading at settlement is final.** NASA revises historical values, and a revision
  afterwards does not reopen a settled policy. The alternative — outcomes an outside party can
  change after the money moved — is worse.
- **The bid bond is thin.** Revealing is optional, so a 1 USDC bond against a 50 USDC payout
  sells the option to walk away from a mispriced bid for 2% of the risk. Structural to
  commit–reveal auctions, and a config value rather than a constant, but ours is not generous.
- **Contract storage is paid by the contract.** Bounded by the per-round commit cap; a
  production version would charge it to the depositor.

## Disclosures

- **Testnet only, and why.** The market contract runs on NEAR testnet, which the hackathon
  rules permit in all four of our tracks. The one exception is NEAR Intents, which has **no
  testnet and none planned** — so the Intents panel talks to the real mainnet 1Click API in
  `dry: true` mode, which is the organisers' own guidance. One consequence worth stating: a
  `.testnet` recipient is rejected by 1Click outright, so the market account and the Intents
  recipient cannot be the same account here. In production they would be.
- **Demo mode.** The testnet deployment is initialised with `demo_mode: true`, which allows
  rounds on windows that have already started so a real season can be replayed before the
  deadline. It relaxes invariant 6 and **nothing else**: a policy still cannot pay twice, pay
  early, or pay the wrong account. It is visible on chain via the `is_demo_mode` view.
- **The oracle trust model as actually shipped.** The contract supports two paths, and
  **both have now settled a policy on testnet**: the keeper path for policies 7 and 8, and
  the OutLayer path for policy 9. The OutLayer path runs a sha256-pinned WASM in a TEE and
  needs no trusted party — the worker proved it could reach `power.larc.nasa.gov`, which was
  the one thing in this design that could have failed for reasons outside this repository.
  The keeper path remains as a fallback, and in it the keeper is trusted completely: it could
  post a reading that is not true, and `scripts/verify-oracle` makes that detectable after
  the fact rather than impossible. The keeper's key is scoped to `submit_observation` alone,
  so a stolen keeper key can lie about rainfall but cannot move money.
- **The owner chooses which oracle binary settles.** `set_oracle_wasm` is owner-only and was
  added so a rebuilt or relocated oracle does not require redeploying to a fresh account —
  which, because the agents' function-call keys are bound to one market contract and cannot
  be re-pointed, would mean recreating every agent. It widens the owner's power by exactly
  one thing: picking the pinned binary. It cannot move money, and the hash must still match
  the bytes the worker fetches, so the owner selects the code but cannot forge its output.
- **`execution_ref` on an OutLayer reading is empty.** The contract looks for an execution id
  in the oracle's return value, but OutLayer returns only the binary's stdout; the id appears
  in its `execution_completed` event instead. The settling transaction hash is the audit link
  in practice, and the field should either be populated from the event or dropped.
- **AI assistance.** Built with Claude Code throughout, under my direction, within the
  hackathon window. The design brief, the gate decisions and every approval are mine.
- **Libraries.** near-sdk 5.30.1, near-contract-standards 5.30.1, near-workspaces 0.24.0,
  wstd 0.6.8 (WASI HTTP), serde, near-api-js 7.5.3, Next.js 16, React 19, vitest, tsx. No
  starter template or boilerplate: the repository was empty at the start of the window and
  every commit is in-window work.
- **Data.** NASA POWER daily `PRECTOTCORR` (Precipitation Corrected), `community=AG`, no API
  key required. `sim/fixtures/rainfall.json` is a frozen pull — 8 sites, 1981–2026, 22,080
  daily values, zero missing — recording its own pull date and source URLs. Rebuild it with
  `node scripts/build-fixture.mjs`. It is committed rather than fetched because NASA revises
  values and tests must not drift.

## What is not done

Stated plainly, because a README that overpromises is worse than a small honest one.

- **The live Intents path is not exercised.** Quotes are real; submitting a deposit and
  polling `/v0/status` through to SUCCESS is implemented behind `ONECLICK_LIVE` and has never
  been run with real funds.
- **Failures on chain have no messages.** See the note on `panic = "abort"` above: the
  contract refuses invalid calls correctly but reports them as a bare wasm trap.
- **The agents' keys cannot be rotated.** `setup-agents` deletes each agent's full-access key,
  which is what makes the security claim true, but it also means an agent is permanently bound
  to the market contract it was set up against and can never be re-pointed or recovered. A
  redeployment to a new market account needs a new set of agent accounts.
- **The commit and reveal windows are 60 seconds**, set at deployment and not changeable
  afterwards — there is no owner-only setter. That is wide enough only because the agents bid
  concurrently; it leaves little room on a slow network.
- **No meta-transaction relayer**, so a buyer still needs a little NEAR for gas.

## License

MIT — see `LICENSE`.
