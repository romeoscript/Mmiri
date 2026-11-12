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

## 2026-11-12 — building the contracts

- **No `panic = "abort"` in the release profile.** near-sdk surfaces failure messages
  through a std panic hook, and `abort` bypasses hooks entirely — every `require!` then
  reaches the caller as a bare "unreachable opcode" with no explanation. Found this while
  debugging a test: the message for "reveal window has closed" was simply absent. Dropping
  `abort` costs about 2 KB of wasm (685 KB → 687 KB) and is the right trade for a contract
  people interact with directly.
- **`overflow-checks = true` kept on.** Silently wrapping arithmetic in a ledger is far
  worse than a failed transaction.
- **NEP-141/145 traits written out by hand in the USDC mock.** `impl_fungible_token_core!`
  and `impl_fungible_token_storage!` are both deprecated in near-contract-standards
  5.30.1, and the storage macro no longer compiles: it generates
  `storage_withdraw(Option<U128>)` against a trait that now takes `Option<NearToken>`.
  The crate's own deprecation note says to implement the traits directly.
- **NEP-171 implemented directly rather than wrapping `NonFungibleToken`.** The standard's
  struct carries approval storage we deliberately do not want, and the policy map already
  holds the owner, so a transfer is a single map write. Change methods stay O(1); only
  enumeration views iterate, and they paginate.
- **`owner_id` lives on the `Policy`.** One field, read at callback time, is the whole of
  invariant 4. It also means no separate owner index to keep consistent.
- **Integration tests run one at a time** (`scripts/test`). Each starts its own sandbox
  node; seven at once contend for ports and descriptors and the suite goes flaky —
  invariant 1 failed in parallel and passed alone. Serial takes ~2 minutes and always
  tells the truth.
- **Test reveal window is 10 seconds, stepped in ~1-second hops.** `fast_forward` moves in
  whole blocks, so a 2-second window is easy to jump clean over. `ff_past` polls the block
  clock and steps until it is past a deadline, which is robust to block timing instead of
  guessing a block count.
- **The test harness recomputes the commit hash independently of the contract.** If
  `commit_preimage` and the test's `commit_hash` ever disagree, every reveal test fails.
  That is the alarm we want.

### Environment note, not a project decision

The NEAR sandbox (`neard` 2.14.0) calls `setrlimit64(RLIMIT_NOFILE, 65535)` unconditionally
and exits if it fails. This development container caps the hard limit at 20000 with
`CAP_SYS_RESOURCE` masked, so the sandbox cannot start without an `LD_PRELOAD` shim that
reports success for that one call. A normal machine's limit is well above 65535, so
`scripts/test` needs nothing special there. Nothing about this is in the repository: it is
a property of where this was built, not of what was built.
