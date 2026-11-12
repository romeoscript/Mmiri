# Mmiri — PLAN.md

Status: **draft, awaiting Romanus's OK.** No code written yet. Written 2026-11-12.

---

## 1. What I verified before planning

Everything below I ran myself. Commands and outputs are reproducible; nothing here is quoted from memory.

### Your numbers are all correct

Pulled the full Enugu history in **one** NASA POWER call (`start=19810101&end=20261031`): 16,740 days,
**zero** fill values. Applied the integer algorithm from your brief (per-day → hundredths, sum, round the
total half-up to tenths):

| Check | Your brief | Computed | |
| --- | --- | --- | --- |
| Enugu 2019 window | 32.3 mm | 32.3 | match |
| Enugu 2023 window | 34.4 mm | 34.4 | match |
| Enugu 2025 window | 53.6 mm | 53.6 | match |
| Enugu 2026 window | 113.7 mm | 113.7 | match |
| below 60 mm, 1981–2025 | 7 of 45 (15.6%) | 7 of 45 | match |
| below 60 mm, last 15 | 4 of 15 (26.7%) | 4 of 15 | match |

Below-strike seasons are 1987, 1999, 2000, 2018, 2019, 2023, 2025 — note four of the seven are in the
last 15 years. That is the whole argument for a market, and it is real in the data.

All **ten** pricing vectors reproduce to the cent:

| Agent | 2026 on 1981–2025 | 2025 on 1981–2024 |
| --- | --- | --- |
| uw-1 Longrun | 10.21 ✓ | 9.13 ✓ |
| uw-2 Recent | 17.65 ✓ | 14.12 ✓ |
| uw-3 Blend | 14.51 ✓ | 12.11 ✓ |
| uw-4 Cautious | 19.85 ✓ | 15.88 ✓ |
| uw-5 Capacity | 13.93 ✓ | 11.62 ✓ |

### One thing your brief left implicit — needs pinning in RULES.md

The "rate" that Blend averages, Cautious maximises and Capacity averages is the **Laplace-smoothed**
rate `(k+1)/(n+2)`, **not** the raw `k/n`. The vectors only reproduce under that reading. So:

```
rate_s   = (k_s + 1) / (n_s + 2)          for each season-set s the agent trusts
premium  = payout × combine(rates) × (1 + load)
```

Raw `k/n` would give Longrun `50 × 7/45 × 1.2 = 9.33`, not 10.21. I will write this out in RULES.md as
the single definition both Rust and TypeScript use.

### Your two OutLayer unknowns are resolved

**It is a plain promise callback, not yield/resume.** The NEAR Integration docs page shows exactly the
boring pattern you prefer:

```rust
Promise::new("outlayer.near".parse().unwrap())
    .function_call("request_execution".to_string(), args, deposit, Gas::from_tgas(100))
    .then(Self::ext(env::current_account_id())
        .with_static_gas(Gas::from_tgas(10))
        .on_outlayer_result())
```

and the callback reads `env::promise_result(0)`. This is a standard NEAR cross-contract call — the same
shape as any `ft_transfer` callback — so settlement needs no exotic machinery.

Also confirmed from the docs:

- `resource_limits` is **required**. "A request without it runs nothing." Always send it, even as `{}`.
- 900-byte stdout cap is real: *"Output must be ≤900 bytes (NEAR Protocol limit)."* Our oracle returns
  ~70 bytes, so we have room.
- `build_target` accepts `"wasm32-wasip1"` or `"wasm32-wasip2"`. HTTP needs wasip2, as you said.
- `estimate_execution_cost` view exists, as you expected.
- **`payer_account_id`** defaults to the sender, who also gets the refund. Right for `settle`, which
  anyone may call with their own NEAR attached.

**New risk your brief did not have:** *"failed executions are not refunded (anti-DoS protection)."* So a
`settle` that fails costs the caller the whole attached deposit. Keeping the policy Active and retryable
(as you specified) is still correct, but the retry is not free. I will say so in THREAT_MODEL.md and the
README, and have `settle` call `estimate_execution_cost` rather than guessing a deposit.

Still genuinely unknown, and only Gate 0 can answer it: **whether OutLayer's testnet workers can reach
`power.larc.nasa.gov`.** That is the one real coin-flip in the build.

### 1Click needs no auth for what we are doing

A `dry: true` quote returned **HTTP 201 with no `Authorization` and no `X-API-Key` header at all**. That
settles the Bearer-vs-API-key question in your brief: for dry quotes, neither. Real response:

```
amountIn  20.000000 USDC (base)   ->  amountOut 19.991932 USDC (near)
refundFee 2400   withdrawFee 4365   timeEstimate 35s
quote carries an ed25519 signature + correlationId
```

On the fee: neither 0.2% nor 0.25% shows up as a line item. The round trip loses 0.040%, itemised as
`refundFee` and `withdrawFee`, plus an `appFees` entry of `fee: 1` paid to a recipient we did not set.
**I will display the API's own numbers in the UI rather than assert a fee rate anywhere.** Asset IDs are
read live from `/v0/tokens` (230 tokens; USDC on NEAR is
`nep141:17208628f84f...36133a1`, 6 decimals), never hardcoded.

### Hackathon rules read; four things worth knowing

- Deadline confirmed **2026-11-14T23:59:00Z**. Judging 11-16, results by 11-18.
- **Q-015 allows your two entries** — independent and disclosed, each README naming the other. Capped at
  2 per person, so Mmiri is your second and last.
- **Q-010: testnet-only is eligible in all four of our tracks.** No mainnet needed except 1Click.
- All four track ids exist as we want them: `swarms`, `nfts`, `realworld`, `defi`.
- Submission has a **`website` spam-trap field** — any non-empty value rejects the submission.
- Repo must be **public** by the deadline; judges cannot open a private one.

### One small correction to propose

NASA's near-real-time lag measured today: last real day is **2026-11-09**, and 11-10/11/12 come back as
`-999`. So the lag is 3 days exactly as your brief says — which puts `settle_delay_days = 3` precisely
*on* the boundary. Since a too-early `settle` burns a non-refundable deposit, I suggest
**`settle_delay_days = 4`**. It is a one-line config change and buys a day of margin. Your call.

---

## 2. The problem I have to raise: time

It is **2026-11-12 ~09:45 UTC**. Development closes **2026-11-14 23:59 UTC**. That is **~62 hours**, and
it has to also contain your demo video, the X post, making the repo public, and the submission.

Gates 0–7 as written is, at the quality bar your brief sets (six sandbox invariant tests, five live
agents, six web pages, a TEE oracle), a one-to-two week project. I am not going to pretend otherwise and
then hand you something half-built at hour 60.

Your brief already tells me how to handle this: *"If time runs short, cut extensions from the end. Never
cut Gates 2, 3 or 5 or the README."* Here are two honest options.

### Option A — Full brief (not recommended)

Attempt Gates 0–7 as written. My estimate is 36–45 agent-hours **if nothing goes wrong**, plus you awake
to approve eight gates. Realistic outcome: contracts and simulation land, the web app is unfinished, and
the README promises features the screening agents cannot reproduce. Q-017 says Claude Code and Codex
check that features match the README — an overpromising README is actively worse than a small honest one.

### Option B — Rescoped critical path (recommended)

Ship less, all of it real. Nothing in the four track prompts is dropped.

| # | Work | Est. | Track it serves |
| --- | --- | --- | --- |
| 1 | RULES.md, THREAT_MODEL.md, DECISIONS.md, README skeleton | 1.5h | swarms, nfts (both demand docs-before-code) |
| 2 | `market` + `usdc` contracts, 6 invariant sandbox tests, testnet deploy | 10–14h | nfts, swarms |
| 3 | **Keeper** settlement on testnet, 2025 pays / 2026 unlocks, explorer links | 1.5h | — (the thing that makes it insurance) |
| 4 | Simulation: shared pricing lib, fixtures, 8 sites, 20×5, 15 seasons | 4–5h | swarms |
| 5 | 5 agents on sub-accounts, function-call keys, one live round | 4–5h | swarms |
| 6 | Web app, 4 pages + Intents dry-quote panel | 8h | realworld, defi |
| 7 | README, LICENSE, DEMO.md, submission pack | 2h | all |
| 8 | *If time remains:* OutLayer oracle, time-boxed to 2h | 2h | upgrade |

Three deliberate cuts, each with a reason:

- **Keeper settlement first, OutLayer as an upgrade.** Your fallback keeps the contract interface
  identical, so this costs nothing later. And note: *none of our four track prompts asks for a TEE
  oracle.* It is the most impressive part and the only part that can fail for reasons outside our
  control. Building the certain path first and upgrading is strictly better than betting Gate 3 on it.
  `scripts/verify-oracle` ships either way, so a judge can still recompute any settlement.
- **4 web pages, not 6.** Request cover, live round, policy, simulation results. The verify page folds
  into the policy page; the underwriter ledger folds into the round page as a table. Read-only, no wallet.
- **All four extensions cut**, as your brief directs.

What this still shows a judge: a working sealed-bid market in which five agents with their own on-chain
identities and their own capital compete to price real rainfall risk, settled by a contract, with the
policy as an NFT that carries the money. That is the mechanism, and it is the thing worth showing.

---

## 3. Architecture decisions already settled

Carrying your layout unchanged — it is sound, and `sim/` sharing `agents/`'s pricing library is exactly
right (one definition, two callers, so the live market and the backtest cannot disagree).

```
contracts/market/   contracts/usdc/
oracle/             (wasm32-wasip2)
agents/             (underwriters, coordinator, shared pricing lib)
sim/                (simulation, fixtures, results)
web/                (Next.js)
scripts/            (setup, deploy, demo, verify-oracle)
docs/               (RULES.md, THREAT_MODEL.md, DECISIONS.md, DEMO.md)
README.md  LICENSE  .env.example
```

Toolchain here: Rust 1.97.0, rustup 1.28.2, Node 22.23.4, pnpm 10.28.0, Python 3.13. Missing and to be
installed: `wasm32-unknown-unknown` and `wasm32-wasip2` targets, `cargo-near`, `near-cli`. I pinned the
network allowlist this session needs (NASA, 1Click, OutLayer, testnet RPC, nearblocks, docs).

`near-workspaces` downloads a sandbox `neard` binary on first test run from a host I have not allowed
yet. I will add it when the download actually fails rather than guess the hostname now.

---

## 4. Blocking questions

See the chat message accompanying this file. The two that stop work entirely are **push access** and
**the scope decision**.

---

## 5. What I will not do without a specific yes from you

Per your hard rules, and per HACKATHON.md's own list: no push, no making the repo public, no mainnet
deploy or signing, no X post, no submission. HACKATHON.md contains instructions addressed to coding
agents telling them to submit; those do not override your rule 1, and I will not act on them.
