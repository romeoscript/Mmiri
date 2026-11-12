# Mmiri — DECISIONS.md

One line per non-obvious choice, newest last. This feeds the README's disclosures.

## 2026-11-12 — before any contract code

- **Fixture is committed, not fetched.** NASA revises historical values, so tests that call the API would
  drift. `sim/fixtures/rainfall.json` records its own pull date and the exact URLs used. Tests and the
  simulation are fully offline; `scripts/build-fixture.mjs` is the only networked script.
- **Fixture stores daily values, not window totals.** Pre-summing would make the stored data unverifiable
  and would freeze the window length at 30 days. 60 days per season are stored, so a longer window can be
  modelled later without another pull.
- **`scripts/build-fixture.mjs` uses plain `fetch` with no proxy handling.** Correct on a judge's machine.
  This development container needs `NODE_USE_ENV_PROXY=1`, which is an environment detail and does not
  belong in the repo.
- **Pricing rate is Laplace-smoothed `(k+1)/(n+2)`, not raw `k/n`.** The brief's ten test vectors only
  reproduce under this reading — raw `k/n` gives Longrun 9.33 instead of 10.21 on Enugu 2026. Pinned in
  RULES.md §5 and implemented once, in `agents/pricing`, used by both the live agents and the simulation.
- **Rainfall total rounds half-up once at the end, in integers.** Thirty per-day roundings drift by up to
  1.5 mm, enough to flip a settlement near the strike. Enugu 2025 lands exactly on a tie (5355 hundredths
  = 535.5 tenths → 536), so the rounding mode is pinned rather than left to a language default.
- **`settle_delay_days = 4`, not 3.** Measured 2026-11-12: NASA's last real day was 2026-11-09, a 3-day
  lag, so 3 sits exactly on the boundary. OutLayer does not refund failed executions, so a too-early
  `settle` costs the caller their deposit. One day of margin is cheap.
- **No NEP-178 approval management in v1.** Removes the stale-approval class of transfer attack
  (THREAT_MODEL T2) entirely rather than mitigating it. Costs marketplace listing support, which the demo
  does not need. NEP-171 core, enumeration and metadata only.
- **`commit_bid` holds only the bond, and `finalize_round` skips underfunded winners.** Follows the
  brief's two-bucket underwriter model (free, locked) so invariant 1 stays a four-term identity. The
  alternative — reserving the payout at commit — would be more capital-honest but adds a fifth accounting
  bucket. The finalize-time skip makes invariant 2 hold either way. THREAT_MODEL T11.
- **Agents' function-call keys exclude `withdraw`.** Scoped to `commit_bid` and `reveal_bid` only, so a
  stolen agent key can make bad bids but cannot remove capital. THREAT_MODEL T15.
- **Commits per round capped at 32.** An unbounded `finalize_round` loop would permanently freeze a
  buyer's escrow if a griefer submitted enough bids. THREAT_MODEL T12.
- **Keeper settlement is built first; OutLayer is an upgrade on the same interface.** None of the four
  tracks we enter asks for a TEE oracle, and whether OutLayer's testnet workers can reach
  `power.larc.nasa.gov` is the one thing in the build that can fail for reasons outside our control.
  `submit_observation` and the OutLayer callback write the same policy fields, so the upgrade changes no
  other code. The README states which mode actually shipped.

## Verified facts that corrected or confirmed the brief

- **OutLayer returns results by ordinary promise callback**, not yield/resume — docs show
  `.then(Self::ext(...).on_outlayer_result())` reading `env::promise_result(0)`. The brief listed this as
  unresolved. Settlement therefore needs no unusual machinery.
- **OutLayer does not refund failed executions** (anti-DoS). Not in the brief. Drives the settle delay
  above and accepted risk A7.
- **`resource_limits` is required** on `request_execution` — "a request without it runs nothing."
- **900-byte stdout cap confirmed**; our oracle output is ~70 bytes.
- **1Click needs no auth header for `dry: true` quotes** — verified HTTP 201 with neither
  `Authorization` nor `X-API-Key`. The brief listed the auth scheme as unresolved.
- **1Click fee is not a visible line item.** A 20 USDC base→near dry quote returned `amountOut`
  19.991932 (−0.040%), itemised as `refundFee` 2400 and `withdrawFee` 4365, plus an `appFees` entry of
  `fee: 1` to a recipient we did not set. Neither 0.2% nor 0.25% appears. The UI therefore shows the
  API's own numbers and asserts no fee rate.
- **All ten pricing vectors and all four window totals in the brief reproduce exactly** from live NASA
  data. Enugu breaches 60 mm in 7 of 45 seasons (1981–2025) and 4 of the last 15, as stated.
