# Mmiri — RULES.md

The rules of the market, written before the contract. Where this file and the code disagree, the code is
wrong and this file is the specification.

Every definition here is given once and used by both implementations: the Rust contract
(`contracts/market`) and the TypeScript agents and simulation (`agents/pricing`, `sim/`). Two
implementations of the same rule that can drift is a bug waiting to happen, so the commit hash, the
pricing formula and the rainfall total each have exactly one definition below.

---

## 1. What is being traded

A **policy** is a promise: *if the rain falling on one place over one 30-day window totals less than a
strike, pay the holder a fixed amount.* There is no loss adjustment, no claim form and no assessor. The
rainfall total decides, and it is read from one public dataset.

**Terms** identify the risk completely:

| Field | Type | Meaning |
| --- | --- | --- |
| `lat_e4` | `i32` | Latitude in degrees × 10,000. Enugu = `64500`. |
| `lon_e4` | `i32` | Longitude in degrees × 10,000. Enugu = `75100`. |
| `start` | `u32` | First day of the window, `YYYYMMDD`. |
| `days` | `u16` | Window length in days. 30 for every policy we sell. |
| `strike_mm_x10` | `u32` | Strike in tenths of a mm. 60.0 mm = `600`. |
| `payout` | `u128` | USDC base units, 6 decimals. 50 USDC = `50000000`. |

Integers throughout. No floats anywhere in the money path, in either language. A float that rounds
differently in Rust and in JavaScript would make the contract and the agents disagree about who owes
what, so there are none.

---

## 2. One round, start to finish

A text sequence diagram of a single round. `uw-N` are underwriter agents, each on its own NEAR
sub-account.

```
buyer                market contract            uw-1 .. uw-5              NASA POWER
  |                        |                         |                         |
  |-- ft_transfer_call --->|                         |                         |
  |   msg = RequestCover   |                         |                         |
  |   amount = max premium |                         |                         |
  |                        |-- round opens ----------|                         |
  |                        |   phase = Commit        |                         |
  |                        |   escrow = amount       |                         |
  |                        |                         |                         |
  |                        |<-- commit_bid ----------|  sha256(round,premium,  |
  |                        |    (hash only)          |  salt,bidder); bond     |
  |                        |                         |  held; premium hidden   |
  |                        |                         |                         |
  |                     commit deadline passes       |                         |
  |                        |   phase = Reveal        |                         |
  |                        |                         |                         |
  |                        |<-- reveal_bid ----------|  premium + salt;        |
  |                        |    (premium, salt)      |  hash checked;          |
  |                        |                         |  bond returned          |
  |                        |                         |                         |
  |                     reveal deadline passes       |                         |
  |                        |                         |                         |
  |            anyone calls finalize_round           |                         |
  |                        |   lowest valid premium wins                       |
  |                        |   winner's payout -> locked                       |
  |                        |   premium -> winner's free balance                |
  |<-- refund of ----------|   policy NFT minted to buyer                      |
  |    (escrow - premium)  |   phase = Settled                                 |
  |                        |                                                   |
  |            ... the 30-day window elapses ...                               |
  |            ... plus settle_delay_days ...                                  |
  |                        |                                                   |
  |            anyone calls settle(policy_id), attaching NEAR                  |
  |                        |------- request_execution ------------------------->|
  |                        |        (pinned wasm hash + terms)      fetch ----->|
  |                        |<------ on_oracle_result --------------- mm_x10 ----|
  |                        |                                                   |
  |                        |   mm_x10 < strike ? pay current NFT owner         |
  |                        |                   : unlock winner's collateral    |
```

Two properties of this shape are worth naming, because they are the point:

- **Nobody files a claim.** Settlement is a function anyone may call. The buyer does not have to know
  it happened, and cannot be denied by not knowing.
- **The buyer never names a price.** They state the most they will pay. The market finds the rest.

---

## 3. Sealed bids: the commit hash

Bids are sealed so that an underwriter cannot see a rival's price and undercut it by a cent. Commit, then
reveal.

The commit is the SHA-256 of one canonical ASCII string:

```
preimage = "mmiri:bid:v1:" || round_id || ":" || premium || ":" || salt_hex || ":" || bidder
commit   = sha256(utf8(preimage))
```

where

- `round_id` — decimal ASCII, no leading zeros, no sign. `"7"`.
- `premium` — USDC base units as decimal ASCII, no leading zeros. 12.50 USDC is `"12500000"`.
- `salt_hex` — exactly 32 random bytes, lowercase hex, 64 characters.
- `bidder` — the bidding account id as ASCII, e.g. `"uw-3.mmiri-demo.testnet"`.

The encoding is unambiguous because `:` cannot occur inside any field: NEAR account ids are drawn from
`[a-z0-9._-]`, and the other three fields are decimal or hex. So no two different bids can produce the
same preimage.

Each component is there for a reason:

- **`round_id`** stops a commit being replayed in a different round.
- **`bidder`** stops another account from copying a commit off the chain and revealing it first. Without
  it, a watcher could steal a rival's sealed price.
- **`salt`** stops a brute-force search over plausible premiums. 32 bytes makes the commit
  information-free. An agent that reuses a salt leaks its price; agents draw a fresh one per bid.
- **`"mmiri:bid:v1"`** domain separation. A hash made for Mmiri v1 cannot be valid anywhere else, and a
  future rule change bumps the version rather than silently reinterpreting old commits.

A reveal is accepted only if `sha256` of the recomputed preimage equals the stored commit, which is why a
bid can never be revealed at a premium other than the one committed (invariant 5).

---

## 4. Who wins

At `finalize_round`, callable by anyone once the reveal deadline has passed:

1. Consider only **revealed** bids whose premium is **at or under** the buyer's escrowed maximum.
2. Sort ascending by premium. Break ties by **earliest commit** — each commit is stamped with a
   per-round sequence number, so the ordering is total and deterministic.
3. Walk that order and take the first bidder whose **free balance still covers the payout**. A bidder who
   has withdrawn capital since committing is skipped, not allowed to win unfunded. (See §9.)
4. The winner:
   - has `payout` moved from free balance to locked balance,
   - has `premium` credited to its free balance,
   - and the buyer is refunded `escrow − premium`.
5. The policy NFT is minted to the buyer. **Token id equals round id.**
6. Bonds of underwriters who committed but never revealed go **to the buyer**, not to the contract. A
   silent bidder wastes the buyer's round, so the buyer is the one compensated.

If no bid qualifies, the buyer is refunded in full and no policy is minted. A round with no bidders costs
the buyer nothing but time — which is the honest outcome when nobody will carry the risk at that price.

---

## 5. Pricing

Each agent counts how often this window at this place fell below this strike, using **only seasons that
ended before the policy's window starts**. Nothing may look ahead; a backtest that peeks is worthless.

For a season set `s` with `k_s` breaches out of `n_s` seasons:

```
rate_s = (k_s + 1) / (n_s + 2)
```

This is Laplace smoothing — the rule of succession. It matters at these sample sizes: 7 breaches in 45
seasons is a raw 15.6%, but with only 45 observations the honest estimate of next year's probability is
17.0%, and a strike that has *never* been breached is priced at a small positive rate rather than free.
An underwriter quoting zero on an unbreached strike is one bad season from insolvency.

**This smoothed rate, not the raw `k/n`, is what the strategies below combine.** Using raw `k/n` changes
every quote (Longrun on Enugu 2026 would be 9.33 rather than 10.21), so it is the one definition most
likely to drift between two implementations. It lives in `agents/pricing` and nowhere else.

```
premium = payout × combine(rates) × (1 + load)
```

rounded half-up to the cent (USDC base units).

| Agent | Seasons it trusts | `combine` | Load |
| --- | --- | --- | --- |
| uw-1 Longrun | all since 1981 | `rate_all` | 20% |
| uw-2 Recent | the last 15 | `rate_recent` | 20% |
| uw-3 Blend | both | `(rate_all + rate_recent) / 2` | 25% |
| uw-4 Cautious | both | `max(rate_all, rate_recent)` | 35% |
| uw-5 Capacity | both | `(rate_all + rate_recent) / 2` | 20% → 60% as its book fills |

The load is the margin over expected loss: the price of carrying variance. These five are not meant to be
five opinions of equal merit. They are five different answers to one question — *how much does the distant
past tell you about next season* — and the simulation exists to let capital settle it.

uw-5's load rises linearly with utilisation `u` (locked ÷ total capital): `load = 0.20 + 0.40 × u`. A
nearly full book quotes nearly double, which is how a solvent underwriter rations its last capital rather
than selling it cheapest.

### Test vectors

A 50 USDC payout, 60.0 mm strike, Enugu, 30 days from 15 April. These are unit tests, not illustrations;
they are checked against the committed fixture, offline.

| Agent | 2026 season, priced on 1981–2025 | 2025 season, priced on 1981–2024 |
| --- | --- | --- |
| uw-1 Longrun | 10.21 | 9.13 |
| uw-2 Recent | 17.65 | 14.12 |
| uw-3 Blend | 14.51 | 12.11 |
| uw-4 Cautious | 19.85 | 15.88 |
| uw-5 Capacity (empty book) | 13.93 | 11.62 |

Underlying counts: 1981–2025 gives 7 breaches in 45 seasons and 4 in the last 15; 1981–2024 gives 6 in 44
and 3 in the last 15.

### Declining to bid

An agent does not bid if winning would push its exposure in **one grid cell with an overlapping window**
above **30% of its total capital**. Concentration, not total leverage, is what kills an insurer: a book of
one hundred policies on one grid cell is one policy. The check is per cell and per overlapping window,
because two policies on the same cell in the same month are the same bet made twice.

---

## 6. Reading the rain

One dataset, named in advance: **NASA POWER daily `PRECTOTCORR`** ("Precipitation Corrected"), in mm/day,
`community=AG`. Missing days carry the fill value `-999.0`.

The oracle program reads terms on stdin and prints a total on stdout:

```
in   {"lat_e4":64500,"lon_e4":75100,"start":20250415,"days":30}
out  {"mm_x10":536,"days_valid":30,"source":"NASA POWER PRECTOTCORR"}
```

The total is computed in integers so that every implementation agrees exactly:

1. For each day in the window, if the value is the fill value, **skip it and do not count it valid**.
   Otherwise convert it to **hundredths of a mm** (× 100) and add it to a running integer sum.
2. After the loop, convert the sum to **tenths**, rounding **half away from zero** exactly once.
3. `days_valid` is the number of days that were not the fill value.

Rounding once at the end, not per day, is deliberate: thirty per-day roundings accumulate up to 1.5 mm of
drift, which is enough to flip a settlement near the strike. NASA returns values at two decimal places, so
step 1 is exact and the only rounding in the whole process is step 2.

The tie case is real, not hypothetical: Enugu 2025 sums to 5355 hundredths, exactly 535.5 tenths, and
rounds to **536**. Half-up is therefore pinned, not left to a language default.

A reading is only accepted if `days_valid == days`. A partial window is not a cheap payout; it is a
failed read, and the policy stays open for another attempt. NASA's near-real-time data lags about 3 days,
which is why settlement waits (§7).

`scripts/verify-oracle` recomputes any policy's reading from the public API, so a settlement can be
checked by anyone against the same source without trusting us.

---

## 7. Settlement

`settle(policy_id)` may be called **by anyone** once `window end + settle_delay_days` has passed. The
caller attaches the NEAR for the off-chain run and is refunded whatever is unused.

The delay exists because NASA's data for the last few days is not yet published. Measured on 2026-11-12,
the last day with real data was 2026-11-09 — a 3-day lag — so `settle_delay_days` is **4**, one day of
margin. A `settle` attempted too early fails the `days_valid` check, and OutLayer does **not refund
failed executions**, so an early call wastes the caller's deposit. The delay protects callers from a
mistake that costs them money.

On the result:

- `mm_x10 < strike_mm_x10` → the policy pays. The payout goes to **whoever holds the token at callback
  time**, not whoever held it at `settle` (see §8 and THREAT_MODEL.md). Status becomes `PaidOut`.
- otherwise → the underwriter's collateral is unlocked. Status becomes `Expired`.

Either way the reading and the execution reference are stored on the policy, so the settlement can be
audited later.

If the run fails, the policy stays `Active` and `settle` can be called again. It is never left in a state
only an owner could rescue.

If paying the holder fails — most likely because they have no storage deposit registered on the USDC
contract — the amount is recorded as **claimable** and `claim_payout` transfers it on demand. Money owed
is never silently dropped and never stranded.

---

## 8. The policy is an NFT, and that is not decoration

The policy is an NEP-171 token whose id is the round id. It is the *bearer instrument*: the right to be
paid attaches to the token, not to the account that bought it.

So rainfall cover becomes transferable. A farmer who needs cash before the window closes can sell the
policy; a co-operative can hold cover for its members; a lender can take it as security against the loan
it is funding. None of that needs our permission, because ownership is the whole mechanism.

The rule that makes it safe is one line: **the payout is sent to the owner at callback time.** The
transfer threat model — including a sale deliberately timed inside the async gap between `settle` and its
callback — is in THREAT_MODEL.md, and it has a test.

---

## 9. Invariants

Each of these has at least one test that fails if the invariant breaks. They are the contract's actual
specification; everything above is how we get here.

1. **Conservation.** USDC held by the contract equals the sum of free balances, locked balances, open
   escrows and held bonds. No path creates or destroys value.
2. **Collateral.** An underwriter's locked balance equals the total payout of its `Active` policies.
   Every promise is fully funded at all times; there is no fractional reserve.
3. **At most once, never early.** A policy pays at most once, and never before `window end +
   settle_delay_days`.
4. **The holder is paid.** The payout goes to the token owner as at the callback, including when the
   token is transferred between `settle` and its callback.
5. **Sealed means sealed.** A bid cannot be revealed at any premium other than the one committed.
6. **No hindsight.** Outside demo mode, a round cannot open for a window that has already started.

### Demo mode

Invariant 6 is the one we deliberately relax, and only with the flag set at init, visible in a view and
stated in the README. Demo mode permits windows in the past, so a real season — 2025, which pays, and
2026, which does not — can be replayed on testnet before the deadline. Without it, demonstrating
settlement would mean waiting 34 days.

Demo mode never changes any other rule. It cannot make a policy pay twice, pay early, or pay the wrong
account.

### On rule 3, step 3

`commit_bid` requires free balance ≥ `payout + bond` but holds only the bond, as specified — it does not
reserve the payout. An underwriter can therefore commit to several rounds, or withdraw after committing,
and arrive at `finalize_round` unable to cover. The finalize-time skip in §4 step 3 is what makes this
safe: an underfunded bidder loses the round rather than winning a policy it cannot collateralise, so
invariant 2 holds by construction. The trade-off is recorded in DECISIONS.md.
