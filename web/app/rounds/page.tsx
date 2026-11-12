import {
  MARKET_ID,
  contractConfigured,
  effectivePhase,
  explorerAccount,
  getConfig,
  getRounds,
  getSolvency,
  getUnderwriters,
} from "@/lib/near";
import { usdc } from "@/lib/data";

export const metadata = { title: "Rounds & underwriters — Mmiri" };
export const dynamic = "force-dynamic";

export default async function RoundsPage() {
  if (!contractConfigured()) {
    return (
      <main>
        <h1>Rounds &amp; underwriters</h1>
        <p className="lede">
          Live sealed-bid rounds, the underwriters&rsquo; capital ledger, and the
          contract&rsquo;s own solvency check.
        </p>
        <NoContract />
        <HowARoundWorks />
      </main>
    );
  }

  const [rounds, underwriters, solvency, config] = await Promise.all([
    getRounds(50),
    getUnderwriters(20),
    getSolvency(),
    getConfig(),
  ]);

  const now = Math.floor(Date.now() / 1000);

  return (
    <main>
      <h1>Rounds &amp; underwriters</h1>
      <p className="lede">
        Reading <a href={explorerAccount(MARKET_ID)}>{MARKET_ID}</a> directly over RPC. No
        wallet needed for anything on this page.
      </p>

      {config?.demo_mode ? (
        <div className="notice">
          <strong>Demo mode is on.</strong> This deployment accepts rounds on windows that
          have already started, so a real season can be replayed before the hackathon
          deadline. It relaxes that one rule and nothing else — a policy still cannot pay
          twice, pay early, or pay the wrong account.
        </div>
      ) : null}

      {solvency ? (
        <>
          <h2>Does the contract hold what it owes?</h2>
          <div className="grid cols-4">
            <div className="tile">
              <div className="label">Underwriters&rsquo; free capital</div>
              <div className="value">{usdc(solvency.total_free)}</div>
              <div className="note">available to bid</div>
            </div>
            <div className="tile">
              <div className="label">Locked as collateral</div>
              <div className="value">{usdc(solvency.total_locked)}</div>
              <div className="note">behind live policies</div>
            </div>
            <div className="tile">
              <div className="label">Buyer escrow + bonds</div>
              <div className="value">
                {usdc((BigInt(solvency.total_escrow) + BigInt(solvency.total_bonds)).toString())}
              </div>
              <div className="note">open rounds and held bid bonds</div>
            </div>
            <div className="tile">
              <div className="label">Books balance</div>
              <div className="value">
                {solvency.balanced ? (
                  <span style={{ color: "var(--success-text)" }}>yes</span>
                ) : (
                  <span style={{ color: "var(--status-critical)" }}>NO</span>
                )}
              </div>
              <div className="note">
                {usdc(solvency.obligations)} owed vs {usdc(solvency.tracked_balance)} held
              </div>
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            This is invariant 1 from <span className="mono">docs/RULES.md</span>, exposed as a
            view so it can be checked from outside rather than only in tests: every USDC unit
            the contract holds sits in exactly one of free, locked, escrow, bonds or
            claimable. A &ldquo;no&rdquo; here would be a bug, not a market condition.
          </p>
        </>
      ) : null}

      <h2>Underwriters</h2>
      {underwriters && underwriters.length > 0 ? (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Free</th>
                <th className="num">Locked</th>
                <th className="num">Total</th>
                <th className="num">Utilisation</th>
              </tr>
            </thead>
            <tbody>
              {underwriters.map(([id, uw]) => {
                const free = BigInt(uw.free);
                const locked = BigInt(uw.locked);
                const total = free + locked;
                return (
                  <tr key={id}>
                    <td>
                      <a href={explorerAccount(id)} className="mono">
                        {id}
                      </a>
                    </td>
                    <td className="num">{usdc(uw.free)}</td>
                    <td className="num">{usdc(uw.locked)}</td>
                    <td className="num">{usdc(total.toString())}</td>
                    <td className="num">
                      {total === 0n ? "—" : `${((Number(locked) / Number(total)) * 100).toFixed(0)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="notice">
          No underwriters have deposited capital yet. An agent joins by sending USDC to the
          market with the message <span className="mono">&quot;Deposit&quot;</span>.
        </div>
      )}

      <h2>Rounds</h2>
      {rounds && rounds.length > 0 ? (
        rounds
          .slice()
          .reverse()
          .map((r) => (
            <div className="card" key={r.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "baseline",
                }}
              >
                <h3 style={{ margin: 0 }}>
                  Round {r.id} · {usdc(r.terms.payout)} USDC of cover
                </h3>
                <span className="chip">
                  <span
                    className="dot"
                    style={{
                      background:
                        r.phase === "Settled"
                          ? "var(--status-good)"
                          : r.phase === "Refunded"
                            ? "var(--text-muted)"
                            : "var(--status-warning)",
                    }}
                  />
                  {effectivePhase(r, now)}
                </span>
              </div>
              <p className="small muted" style={{ margin: "6px 0 12px" }}>
                Buyer <span className="mono">{r.buyer}</span> · strike{" "}
                {(r.terms.strike_mm_x10 / 10).toFixed(1)} mm over {r.terms.days} days from{" "}
                {String(r.terms.start)} · will pay at most {usdc(r.max_premium)} USDC
              </p>

              <table>
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Bidder</th>
                    <th>Sealed commitment</th>
                    <th className="num">Revealed premium</th>
                  </tr>
                </thead>
                <tbody>
                  {r.commits.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        No bids yet.
                      </td>
                    </tr>
                  ) : (
                    r.commits.map((c) => (
                      <tr key={c.bidder}>
                        <td className="num muted">{c.seq}</td>
                        <td className="mono">{c.bidder}</td>
                        <td className="mono small muted">
                          {Buffer.from(c.hash).toString("hex").slice(0, 16)}…
                        </td>
                        <td className="num">
                          {c.revealed_premium ? (
                            <strong>{usdc(c.revealed_premium)}</strong>
                          ) : (
                            <span className="muted">sealed</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {r.winner ? (
                <div className="notice info" style={{ marginBottom: 0 }}>
                  Cleared at <strong>{usdc(r.clearing_premium!)} USDC</strong> to{" "}
                  <span className="mono">{r.winner}</span>, which locked{" "}
                  {usdc(r.terms.payout)} USDC as collateral. Policy{" "}
                  <a href={`/policies/${r.id}`}>#{r.id}</a> was minted to the buyer.
                </div>
              ) : null}
            </div>
          ))
      ) : (
        <div className="notice">No rounds have been opened on this deployment yet.</div>
      )}

      <HowARoundWorks />
    </main>
  );
}

function NoContract() {
  return (
    <div className="notice">
      <strong>No contract is configured for this deployment.</strong> Set{" "}
      <span className="mono">NEXT_PUBLIC_MARKET_ID</span> (and{" "}
      <span className="mono">NEXT_PUBLIC_NEAR_RPC</span> if not testnet) to point this page
      at a deployed market. The <a href="/simulation">simulation</a> runs the same auction
      rules offline and needs nothing configured.
    </div>
  );
}

function HowARoundWorks() {
  return (
    <>
      <h2>How one round works</h2>
      <ol className="small" style={{ color: "var(--text-secondary)", maxWidth: "72ch" }}>
        <li>
          The buyer sends USDC to the market with a{" "}
          <span className="mono">RequestCover</span> message. The amount is the most they
          will pay, and it sits in escrow.
        </li>
        <li>
          Each underwriter submits <em>only a hash</em> — sha256 over the round id, its
          premium, a 32-byte salt and its own account. Nobody can read a rival&rsquo;s price,
          and nobody can steal a rival&rsquo;s bid, because the account is inside the hash.
        </li>
        <li>
          After the commit deadline, bidders reveal premium and salt. The contract recomputes
          the hash, so a bid cannot be revealed at any price other than the one committed.
        </li>
        <li>
          Anyone may then finalize. The lowest revealed premium at or under the
          buyer&rsquo;s maximum wins, ties break on the earlier commit, and a bidder who can
          no longer cover the payout is skipped rather than allowed to win uncollateralised.
        </li>
        <li>
          The winner&rsquo;s payout moves to locked collateral, the premium is credited to
          it, the buyer is refunded the difference, and the policy is minted to the buyer as
          an NEP-171 token. Bonds of bidders who never revealed go to the buyer.
        </li>
      </ol>
      <p className="small muted">
        Written down in full, before the contract was written, in{" "}
        <span className="mono">docs/RULES.md</span>.
      </p>
    </>
  );
}
