import { MARKET_ID, contractConfigured, explorerAccount, getPolicies } from "@/lib/near";
import { usdc } from "@/lib/data";

export const metadata = { title: "Policies — Mmiri" };
export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  if (!contractConfigured()) {
    return (
      <main>
        <h1>Policies</h1>
        <p className="lede">
          Each policy is an NEP-171 token. Whoever holds it is owed the payout — that is the
          mechanism, not a label on top of one.
        </p>
        <div className="notice">
          <strong>No contract is configured for this deployment.</strong> Set{" "}
          <span className="mono">NEXT_PUBLIC_MARKET_ID</span> to list live policies. The{" "}
          <a href="/simulation">simulation</a> shows 298 policies written and settled offline.
        </div>
        <WhatTransferMeans />
      </main>
    );
  }

  const policies = await getPolicies(50);

  return (
    <main>
      <h1>Policies</h1>
      <p className="lede">
        Each policy is an NEP-171 token on <a href={explorerAccount(MARKET_ID)}>{MARKET_ID}</a>.
        Whoever holds it when the oracle result arrives is paid.
      </p>

      {policies && policies.length > 0 ? (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Holder</th>
                <th>Underwriter</th>
                <th className="num">Payout</th>
                <th className="num">Premium</th>
                <th className="num">Strike</th>
                <th>Window</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id}>
                  <td className="num">
                    <a href={`/policies/${p.id}`}>
                      <strong>{p.id}</strong>
                    </a>
                  </td>
                  <td className="mono small">{p.owner_id}</td>
                  <td className="mono small">{p.underwriter}</td>
                  <td className="num">{usdc(p.terms.payout)}</td>
                  <td className="num">{usdc(p.premium)}</td>
                  <td className="num">{(p.terms.strike_mm_x10 / 10).toFixed(1)} mm</td>
                  <td className="small">
                    {p.terms.days}d from {String(p.terms.start)}
                  </td>
                  <td>
                    <StatusChip status={p.status} settling={p.settling} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="notice">No policies have been written on this deployment yet.</div>
      )}

      <WhatTransferMeans />
    </main>
  );
}

export function StatusChip({ status, settling }: { status: string; settling?: boolean }) {
  if (settling) {
    return (
      <span className="chip">
        <span className="dot" style={{ background: "var(--status-warning)" }} />
        settling
      </span>
    );
  }
  const colour =
    status === "PaidOut"
      ? "var(--status-critical)"
      : status === "Expired"
        ? "var(--text-muted)"
        : "var(--status-good)";
  const label = status === "PaidOut" ? "paid out" : status === "Expired" ? "expired" : "active";
  return (
    <span className="chip">
      <span className="dot" style={{ background: colour }} />
      {label}
    </span>
  );
}

function WhatTransferMeans() {
  return (
    <>
      <h2>What happens when a policy is transferred</h2>
      <p>
        The policy is a bearer instrument: the right to be paid attaches to the token, not to
        the account that bought it. A farmer who needs cash before the window closes can sell
        the cover; a co-operative can hold policies for its members; a lender can take one as
        security against the loan it is funding.
      </p>
      <p>
        The rule that makes that safe is one line of the contract: <strong>the payout is
        sent to whoever owns the token at the moment the oracle result arrives</strong> — not
        to whoever called <span className="mono">settle</span>, and not to whoever owned it
        when the policy was written.
      </p>
      <p className="small muted">
        That distinction is the whole design. <span className="mono">settle</span> is
        asynchronous: it fires an off-chain request and the answer comes back in a later
        callback. If the contract decided the recipient when{" "}
        <span className="mono">settle</span> was called, a seller could settle, sell the
        policy while the request was in flight, and still collect the money — leaving the
        buyer holding a token that had already paid out to someone else. Resolving the owner
        at callback time closes that window, and there is a sandbox test that sells a policy
        inside the gap and asserts the new holder is paid.
      </p>
      <p className="small muted">
        This version implements NEP-171 core, enumeration and metadata, and deliberately{" "}
        <em>no</em> NEP-178 approval management. A stale approval is the cleanest way for a
        seller to pull a token back mid-settlement, so the mechanism is removed rather than
        guarded. <span className="mono">docs/THREAT_MODEL.md</span> §1 works through every
        way a seller could try to keep the money.
      </p>
    </>
  );
}
