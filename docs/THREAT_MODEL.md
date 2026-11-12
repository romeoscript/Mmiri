# Mmiri — THREAT_MODEL.md

Written before the contract, as the NFTs track prompt asks. The question it starts from is the one that
prompt poses: **every way a seller could try to keep the money after selling the policy.**

The policy NFT is a bearer instrument — the right to be paid attaches to the token. That is the feature,
and it is also the entire attack surface, because every attack below is a way of separating the token
from the money.

Each threat has a mitigation and, where the mitigation is code, a test. Threats we are accepting rather
than solving are in §6, named as such.

---

## 1. The transfer threat model

### T1 — Pay the owner at `settle` instead of at the callback

**The attack.** The seller calls `settle`. The contract notes "pay `seller.testnet`" and fires the
off-chain request. While it is in flight the seller sells the policy and the buyer pays for it. The
callback lands and pays the *seller*. The buyer owns a token that has already paid out to someone else.

This is the single most likely way to get this contract wrong, because caching the owner at `settle` is
the natural way to write it.

**Mitigation.** The payout recipient is resolved **at callback time**, from the token's owner then. The
owner is never captured at `settle` and never passed through the promise.

**Test.** `transfer_during_settlement`: mint, `settle`, transfer to a second account while the promise is
in flight, let the callback land, assert the **second** account received the USDC and the first received
nothing. This is invariant 4 and the test the track prompt asks for.

### T2 — Keep an approval and pull the token back

**The attack.** The seller grants themselves (or keeps an existing) NEP-178 approval, sells the token,
then uses the stale approval to transfer it back before settlement. Payment follows the token, so the
money comes back with it.

**Mitigation.** Two layers. The outer one: **v1 implements NEP-171 core, enumeration and metadata, and
does not implement NEP-178 approval management at all.** No approvals exist, so none can go stale. The
inner one, if approvals are added later: the approval map is cleared on every transfer, as NEP-171
requires.

Dropping approvals costs marketplace listings, which we do not need for this demo, and removes a whole
class of bug. Recorded in DECISIONS.md.

### T3 — Settle twice and be paid twice

**The attack.** The seller calls `settle` twice in quick succession, each with its own attached deposit,
before the first callback resolves. Two callbacks, two payouts, one policy. Or: sell the token between
the two, and collect once as seller and once as holder.

**Mitigation.** A `settling` flag on the policy, set **before** the cross-contract call and cleared only
on failure. A second `settle` while the flag is set is rejected. The status transition to `PaidOut` /
`Expired` is the terminal guard: a policy that is not `Active` cannot be settled.

**Test.** `double_settle_pays_once`: two `settle` calls interleaved, assert exactly one transfer and that
conservation (invariant 1) still holds.

### T4 — Sell to an account that cannot receive the payout

**The attack.** The seller transfers the policy to an account with no storage deposit on the USDC
contract, so `ft_transfer` fails in the callback. If the contract treats a failed transfer as "no payout
owed", the money stays in the contract and the collateral is never released — the seller has destroyed
the buyer's claim out of spite, or simply by accident.

**Mitigation.** A failed payout transfer is recorded as **claimable** against the owner and
`claim_payout` sends it on demand. The policy still becomes `PaidOut` and the collateral accounting still
resolves. Money owed is never dropped and never stranded.

**Test.** `payout_to_unregistered_holder_is_claimable`.

### T5 — Transfer into a contract that re-enters

**The attack.** `nft_transfer_call` moves the token to a contract whose `nft_on_transfer` calls back into
the market — settling, transferring on, or requesting cover — to catch the market in an inconsistent
intermediate state.

**Mitigation.** Transfers during the settlement gap are *allowed by design* (T1 depends on it), so the
defence cannot be a lock. It is that the payout reads the owner at callback time and the status guard is
terminal: whatever the re-entrant call does to ownership, exactly one payout is made, to whoever holds
the token when the callback runs. State is mutated before any external call, never after.

### T6 — Sell a policy whose outcome the seller already knows

**The attack.** The window closes. The seller reads NASA, sees a dry window, knows the policy will pay 50
USDC, and sells it for 20 to someone who has not looked.

**Mitigation — and the limit of it.** This is not a contract bug and we will not try to block the sale;
a bearer instrument that cannot be sold late is not a bearer instrument. What we owe the buyer is
symmetry of information: the policy page computes and displays the reading from the **public** dataset
for any window that has closed, before they buy, and `scripts/verify-oracle` lets anyone do it
independently. The information is free, so an uninformed buyer is a buyer who chose not to look.

---

## 2. Auction integrity

### T7 — Read a rival's price and undercut it

Sealed bids. The commit reveals nothing: 32 bytes of salt make brute force over plausible premiums
useless. See RULES.md §3.

### T8 — Steal a rival's sealed bid

**The attack.** Copy a commit hash off the chain and reveal it first, stealing the bid.

**Mitigation.** The bidder's account id is inside the preimage, so a commit is only valid for the account
that made it. Replaying it elsewhere produces a hash that matches nothing.

### T9 — Commit and never reveal

**The attack.** Flood a round with commits and reveal none, so the buyer's round expires with no cover
and their capital sat in escrow for nothing.

**Mitigation.** The bond is held at commit and **forfeited to the buyer** on non-reveal. Griefing costs
1 USDC per commit and pays the victim.

### T10 — Walk away from a bid that turns out badly — *accepted, and thin*

**The attack.** Reveal is optional. A bidder who, by the reveal window, has concluded their price was too
low simply does not reveal, forfeiting the bond. The commit was therefore not a commitment but an option,
bought for the price of the bond.

This is a structural property of every commit–reveal auction, not a bug in ours, but the parameters
matter and **ours are thin**: a 1 USDC bond against a 50 USDC payout means the option to withdraw costs
2% of the risk carried. A bidder who realises they mispriced by more than 1 USDC should rationally walk.

**Status: accepted for the demo, flagged as tunable.** The bond is a config value, not a constant. An
honest fix is to scale it with the payout (say 5–10%), at the cost of making small bids expensive to
place. We state the number rather than implying the mechanism is airtight.

### T11 — Win a round you cannot collateralise

**The attack.** Commit while funded, withdraw the capital, then win — a policy with no collateral behind
it, breaking invariant 2.

**Mitigation.** `finalize_round` walks the ordered candidates and skips any whose free balance no longer
covers the payout (RULES.md §4 step 3). An underfunded bidder loses the round. Invariant 2 holds by
construction rather than by hoping nobody withdraws.

### T12 — Make a round impossible to finalize

**The attack.** Submit enough commits that `finalize_round` cannot complete within one transaction's gas.
The round can never be finalized, so the buyer's escrow is locked forever.

**Mitigation.** Commits per round are **capped** (32), and every loop in a change method is bounded. No
change method iterates over an unbounded collection — not bids, not policies, not balances. Views may
paginate; change methods may not.

This one is worth stating plainly because an unbounded loop in `finalize_round` would be a permanent
freeze of someone else's money, which is the worst failure mode in the contract.

---

## 3. The money path

### T13 — Credit yourself a balance without sending any USDC

**The attack.** Call `ft_on_transfer` directly on the market contract with `amount: "1000000000"` and
`msg: "Deposit"`. If the contract trusts the arguments, the caller now has a free balance it never
funded, and can bid — and be paid premiums — with money that does not exist.

**Mitigation.** `ft_on_transfer` asserts `predecessor_account_id() == config.usdc_account` and rejects
everything else. Only the USDC contract can tell us a transfer happened.

This is the most dangerous single line in the contract. It gets its own test:
`ft_on_transfer_from_impostor_is_rejected`.

### T14 — Break conservation through a partial failure

Every path that moves USDC either completes or restores the prior accounting. Cross-contract transfers
are followed by a resolve callback that reverses the local bookkeeping on failure — the standard NEP-141
pattern, no deviations. Invariant 1 is asserted at the end of every integration test, not just the ones
about money.

---

## 4. Keys and agents

### T15 — An underwriter agent's key is stolen

**Blast radius, by construction.** Agents hold **function-call access keys only**, scoped to the market
contract and to `commit_bid` and `reveal_bid`. Such a key cannot transfer NEAR, cannot add keys, cannot
call any other contract, and — this part is deliberate — **cannot call `withdraw`**. A thief can make
bad bids with that agent's capital. They cannot take the capital out.

Full-access keys exist only on the parent account, are used only by setup scripts run by hand, and are
never present in any agent, service or long-running process.

`scripts/print-key-permissions` prints each key's `permission` object from the chain, so the claim above
is checkable rather than asserted.

### T16 — The keeper key is stolen (keeper mode only)

**Blast radius: total.** A keeper key can post any reading via `submit_observation`, so it can trigger
payouts on policies that should expire and deny payouts on policies that should pay. In keeper mode the
keeper is trusted, fully, and the README says so in those words.

**Mitigation, such as it is.** The reading is stored on-chain with the policy, and
`scripts/verify-oracle` recomputes it from the public dataset, so a dishonest keeper is *detectable by
anyone* after the fact — but not *prevented*. This asymmetry is exactly why the OutLayer path is the
better one, and why we describe which mode actually shipped rather than describing the better mode.

### T17 — A compromised oracle worker returns a false reading

**Mitigation.** The contract pins the oracle WASM by **sha256**; OutLayer's worker refuses a binary whose
bytes do not match, and the TEE attestation covers the WASM hash and the input hash. So the question is
not "did the right code run" but "do you trust the TEE and the dataset".

**Residual trust, stated:** OutLayer's TEE, and NASA POWER itself. We do not remove those. We make them
nameable and checkable, which is a different and more honest claim than trustlessness.

---

## 5. Data

### T18 — NASA revises a value after we settle

**Accepted and documented.** The reading taken at settlement is final. A later revision does not reopen a
settled policy. The alternative — a contract whose outcomes can be revised by an outside party after the
money moved — is worse.

### T19 — A partial window reads as a dry window

**The attack, or more likely the accident.** Settling before NASA has published the last days of the
window: missing days contribute nothing to the total, so an incomplete window looks drier than it was and
could trigger a payout that is not owed.

**Mitigation.** The callback requires `days_valid == days` and rejects anything else. A partial read is a
failed read, not a cheap payout. The 4-day settle delay keeps honest callers away from the edge.

---

## 6. Accepted risks

Named here so the README and the code agree with each other.

| # | Risk | Why we accept it |
| --- | --- | --- |
| A1 | Basis risk: one NASA grid cell is roughly 56 × 69 km near Enugu. Rain on the cell is not rain on the farm. | Inherent to index insurance. The honest fix is a denser network, not better code. Stated in the README. |
| A2 | The withdraw option in T10 is cheap at a 1 USDC bond. | Parameter, not architecture. Stated rather than hidden. |
| A3 | Not a licensed insurer. This is a demonstration of a mechanism. | Out of scope for a hackathon; stated in the README. |
| A4 | A self-dealing underwriter can buy its own cover to fake volume. | Costs gas, nets zero, moves no value. Cosmetic. |
| A5 | Demo mode allows windows in the past. | Required to demonstrate settlement before the deadline. Set at init, exposed in a view, stated in the README, and it relaxes **only** invariant 6. |
| A6 | Contract storage growth is paid by the contract's own balance. | Bounded by the per-round commit cap; a production version would charge storage to the depositor. |
| A7 | A failed OutLayer execution is not refunded, so a failed `settle` costs the caller. | OutLayer's anti-DoS policy, not ours. The settle delay and the `days_valid` guard keep honest callers out of it. |

---

## 7. What would change in production

Not promises — the honest list of what this is missing, so nobody mistakes a hackathon build for a
product.

- Bond scaled to payout, closing T10 properly.
- Storage charged to the account that causes it (A6).
- More than one data source, with disagreement handled explicitly rather than by trusting one feed.
- A real underwriter onboarding story: who these agents are, what capital they are risking, and under
  whose licence.
- An audit by someone who did not write it.
