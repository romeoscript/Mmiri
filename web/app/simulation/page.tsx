import { ClearingPrice } from "@/components/charts";
import { clearingBySeason, simResults, usdc } from "@/lib/data";

export const metadata = { title: "Simulation — Mmiri" };

export default function SimulationPage() {
  const r = simResults();

  if (!r) {
    return (
      <main>
        <h1>Simulation</h1>
        <div className="notice">
          No results file found. Run <span className="mono">pnpm sim</span> from the
          repository root.
        </div>
      </main>
    );
  }

  const points = clearingBySeason(r);
  const byProfit = [...r.agents].sort((a, b) =>
    BigInt(b.profit) > BigInt(a.profit) ? 1 : BigInt(b.profit) < BigInt(a.profit) ? -1 : 0,
  );
  const worst = byProfit[byProfit.length - 1]!;
  const best = byProfit[0]!;

  return (
    <main>
      <h1>Fifteen seasons, 300 rounds, five opinions</h1>
      <p className="lede">
        The five underwriters disagree about how much the distant past tells you about next
        season. That cannot be settled by argument, only by capital. This runs real Nigerian
        rainfall from {r._meta.seasons} through the same auction rules the contract enforces
        and reports who was still solvent at the end.
      </p>

      <div className="notice info">
        Reproduce it yourself: <span className="mono">pnpm sim</span>. No network, no keys and
        no LLM calls — {r._meta.buyers} buyers, {r._meta.underwriters} underwriters,{" "}
        {r._meta.sites} sites, seed <span className="mono">{r._meta.seed}</span>, against a
        rainfall fixture pulled {new Date(r._meta.fixture_pulled_at).toISOString().slice(0, 10)}.
        Same seed and same fixture give byte-identical output, and a test asserts that.
      </div>

      <div className="grid cols-4">
        <div className="tile">
          <div className="label">Rounds run</div>
          <div className="value">{r.summary.rounds}</div>
          <div className="note">{r.summary.rounds_no_bid} found no bid at all</div>
        </div>
        <div className="tile">
          <div className="label">Policies written</div>
          <div className="value">{r.summary.rounds_cleared}</div>
          <div className="note">each fully collateralised by its underwriter</div>
        </div>
        <div className="tile">
          <div className="label">Paid out</div>
          <div className="value">{r.summary.policies_paid_out}</div>
          <div className="note">
            {(r.summary.payout_rate * 100).toFixed(0)}% of policies written
          </div>
        </div>
        <div className="tile">
          <div className="label">Best and worst</div>
          <div className="value">{best.label}</div>
          <div className="note">
            {worst.label} lost {usdc((-BigInt(worst.profit)).toString())} USDC of its own
            capital
          </div>
        </div>
      </div>

      <h2>Where the capital went</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th className="num">Won</th>
              <th className="num">Bid</th>
              <th className="num">Declined</th>
              <th className="num">Premiums</th>
              <th className="num">Claims</th>
              <th className="num">Loss ratio</th>
              <th className="num">Final capital</th>
              <th className="num">Profit</th>
            </tr>
          </thead>
          <tbody>
            {r.agents.map((a) => {
              const profit = BigInt(a.profit);
              return (
                <tr key={a.strategy}>
                  <td>
                    <strong>
                      {a.account} {a.label}
                    </strong>
                    <div className="small muted">{a.thesis}</div>
                  </td>
                  <td className="num">{a.rounds_won}</td>
                  <td className="num">{a.rounds_bid}</td>
                  <td className="num">{a.rounds_declined}</td>
                  <td className="num">{usdc(a.premiums_earned)}</td>
                  <td className="num">{usdc(a.claims_paid)}</td>
                  <td className="num">
                    {a.loss_ratio === null ? (
                      <span className="muted">n/a</span>
                    ) : (
                      <span
                        style={{
                          color:
                            a.loss_ratio > 1
                              ? "var(--status-critical)"
                              : "var(--success-text)",
                          fontWeight: 600,
                        }}
                      >
                        {(a.loss_ratio * 100).toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="num">{usdc(a.final_capital)}</td>
                  <td
                    className="num"
                    style={{
                      color: profit < 0n ? "var(--status-critical)" : "var(--success-text)",
                      fontWeight: 600,
                    }}
                  >
                    {usdc(a.profit)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
          Loss ratio is claims paid over premiums earned. Above 100% means the agent paid out
          more than it was paid to take the risk. Every agent started with{" "}
          {usdc(r._meta.start_capital)} USDC.
        </p>
      </div>

      <h2>What actually happened</h2>
      <p>
        Longrun prices on all 45 seasons since 1981, so it quotes the lowest premium of the
        five, wins most of the market — and pays for it. Recent, which trusts only the last
        fifteen seasons, is the only agent that made money. Cautious wins nothing at all and
        ends with its capital intact, which is exactly what &ldquo;survive first, compete
        second&rdquo; buys you.
      </p>
      <p>
        Nobody told these agents the climate is drying. The rainfall did, and the ones that
        would not listen lost their own capital. That is the whole mechanism: a market where
        mispricing is punished with the underwriter&rsquo;s money rather than the
        farmer&rsquo;s.
      </p>
      <p className="small muted">
        Capacity&rsquo;s behaviour is emergent rather than scripted. Its load rises as its
        book fills, so it stops being the cheapest bid late in a season and Recent picks up
        the business it drops.
      </p>

      <div className="card">
        <ClearingPrice points={points} />
      </div>

      <h2>Every round</h2>
      <p className="small muted">
        All {r.summary.rounds} rounds with every bid, including the declines, are in{" "}
        <span className="mono">sim/results/results.json</span>. The most recent twenty are
        below.
      </p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Season</th>
              <th>Site</th>
              <th className="num">Strike</th>
              <th className="num">Payout</th>
              <th>Winner</th>
              <th className="num">Cleared at</th>
              <th className="num">Rain</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {r.rounds.slice(-20).reverse().map((round) => (
              <tr key={round.round}>
                <td className="num muted">{round.round}</td>
                <td>{round.season}</td>
                <td style={{ textTransform: "capitalize" }}>{round.site}</td>
                <td className="num">{(round.terms.strike_mm_x10 / 10).toFixed(1)}</td>
                <td className="num">{usdc(round.terms.payout)}</td>
                <td>
                  {round.winner ?? <span className="muted">no bid</span>}
                </td>
                <td className="num">
                  {round.clearing_premium ? usdc(round.clearing_premium) : "—"}
                </td>
                <td className="num">{(round.observed_mm_x10 / 10).toFixed(1)}</td>
                <td>
                  {round.winner === null ? (
                    <span className="muted">—</span>
                  ) : round.paid_out ? (
                    <span className="chip">
                      <span className="dot" style={{ background: "var(--status-critical)" }} />
                      paid out
                    </span>
                  ) : (
                    <span className="chip">
                      <span className="dot" style={{ background: "var(--series-1)" }} />
                      expired
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="footnote">
        Buyers pick a strike between the{" "}
        {r._meta.strike_percentile_band[0]}th and {r._meta.strike_percentile_band[1]}th
        percentile of their site&rsquo;s history before that season, and will pay at most{" "}
        {r._meta.max_premium_bp / 100}% of the payout. Agents price only on seasons that
        ended before the one they are quoting — a backtest that peeks looks brilliant and
        tells you nothing.
      </div>
    </main>
  );
}
