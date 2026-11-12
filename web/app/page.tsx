import { RainfallHistory } from "@/components/charts";
import { SiteControls } from "@/components/site-controls";
import {
  SITE_ORDER,
  defaultStrike,
  historyView,
  mm,
  site,
  sites,
  usdc,
  windowLabel,
} from "@/lib/data";
import { MARKET_ID, contractConfigured } from "@/lib/near";
import { STRATEGIES, USDC, emptyBook, fmtUsdc, quote } from "@pricing";

export const dynamic = "force-dynamic";

const SEASON = 2026;
const PAYOUTS = [30, 50, 80] as const;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; strike?: string; payout?: string }>;
}) {
  const sp = await searchParams;
  const siteId = SITE_ORDER.includes((sp.site ?? "") as never) ? sp.site! : "enugu";
  const s = site(siteId)!;
  const payoutUsdc = PAYOUTS.includes(Number(sp.payout) as never) ? Number(sp.payout) : 50;
  const strike = Number(sp.strike) > 0 ? Number(sp.strike) : defaultStrike(siteId, SEASON);

  const h = historyView(siteId, strike, SEASON);
  const payout = BigInt(payoutUsdc) * USDC;

  // What the five agents would actually quote for this risk, right now, from the same
  // library the live agents use. These are real prices, not illustrations.
  const quotes = STRATEGIES.map((st) => ({
    st,
    q: quote(
      st,
      {
        lat_e4: s.lat_e4,
        lon_e4: s.lon_e4,
        start: Number(`${SEASON}${s.window_start_mmdd}`),
        days: 30,
        strike_mm_x10: strike,
        payout,
      },
      h.totals,
      emptyBook(2000n * USDC),
    ),
  }))
    .filter((x) => x.q.premium !== null)
    .sort((a, b) => (a.q.premium! < b.q.premium! ? -1 : 1));

  const best = quotes[0];

  return (
    <main>
      <h1>Rainfall cover, priced by a market</h1>
      <p className="lede">
        Ask for cover on one place and one 30-day window. Say the most you will pay and
        nothing else. Five underwriter agents, each with its own capital and its own read of
        the history, bid sealed premiums. The lowest bid wins and locks the full payout as
        collateral. When the window closes, NASA&rsquo;s rainfall record decides — nobody
        files a claim.
      </p>

      <SiteControls
        sites={sites().map(({ id, site: x }) => ({
          id,
          name: x.name,
          window: windowLabel(x),
        }))}
        siteId={siteId}
        strike={strike}
        payout={payoutUsdc}
        payouts={[...PAYOUTS]}
      />

      <div className="card">
        <RainfallHistory
          // Only seasons that ended before the one being quoted. Showing the outcome of
          // the season we are pricing would be exactly the hindsight the pricing refuses.
          seasons={h.totals
            .filter((t) => t.season < SEASON)
            .map((t) => ({ season: t.season, mm_x10: t.mm_x10 }))}
          strike_mm_x10={strike}
          siteName={`${s.name} (${s.lat}, ${s.lon})`}
          windowLabel={windowLabel(s)}
        />
      </div>

      <h2>Why this needs a market and not a formula</h2>
      <div className="grid cols-3">
        <div className="tile">
          <div className="label">All seasons since 1981</div>
          <div className="value">{(h.allRate * 100).toFixed(1)}%</div>
          <div className="note">
            fell below {mm(strike)} in {h.all.k} of {h.all.n} seasons
          </div>
        </div>
        <div className="tile">
          <div className="label">Last 15 seasons</div>
          <div className="value">{(h.recentRate * 100).toFixed(1)}%</div>
          <div className="note">
            fell below {mm(strike)} in {h.recent.k} of {h.recent.n} seasons
          </div>
        </div>
        <div className="tile">
          <div className="label">The gap</div>
          <div className="value">
            {h.allRate > 0 ? `${(h.recentRate / h.allRate).toFixed(2)}×` : "—"}
          </div>
          <div className="note">
            how much more often it has happened lately than across the whole record
          </div>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        Both numbers are correct. They disagree, and the premium you should charge differs
        accordingly. No single formula can know which rate is right, because the question —
        how much does the distant past tell you about next season — is a real open question
        about a changing climate. So Mmiri does not pick. It runs an auction, and the
        underwriters that misprice the risk lose their own capital.
      </p>

      <h2>What the five agents would quote for this risk</h2>
      <p className="small muted">
        Computed now, from <span className="mono">agents/pricing</span> — the same library
        the live agents and the simulation use. A {payoutUsdc} USDC payout, {mm(strike)}{" "}
        strike, {windowLabel(s)} {SEASON} at {s.name}.
      </p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Its view of the history</th>
              <th className="num">Breach rate</th>
              <th className="num">Load</th>
              <th className="num">Premium</th>
              <th className="num">% of payout</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map(({ st, q }) => (
              <tr key={st.id}>
                <td>
                  <strong>
                    {st.account} {st.label}
                  </strong>
                  {q === best?.q ? (
                    <>
                      {" "}
                      <span className="chip">
                        <span className="dot" style={{ background: "var(--status-good)" }} />
                        would win
                      </span>
                    </>
                  ) : null}
                </td>
                <td className="small muted">{st.thesis}</td>
                <td className="num">{(q.rate * 100).toFixed(1)}%</td>
                <td className="num">{(q.loadBp / 100).toFixed(0)}%</td>
                <td className="num">
                  <strong>{fmtUsdc(q.premium!)}</strong>
                </td>
                <td className="num">
                  {((Number(q.premium!) / Number(payout)) * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {best ? (
        <div className="notice info">
          At these terms the market would clear at <strong>{fmtUsdc(best.q.premium!)} USDC</strong>{" "}
          — {((Number(best.q.premium!) / Number(payout)) * 100).toFixed(1)}% of the payout —
          written by <strong>{best.st.account} {best.st.label}</strong>. The spread between
          cheapest and dearest here is{" "}
          {fmtUsdc(quotes[quotes.length - 1]!.q.premium! - best.q.premium!)} USDC, which is
          the price of the disagreement above.
        </div>
      ) : null}

      {!contractConfigured() ? (
        <div className="notice">
          <strong>No contract is configured for this deployment</strong>, so there is nothing
          to sign here yet. Everything above is computed from the committed rainfall fixture
          and the real pricing library, and the read-only pages work without a wallet. Set{" "}
          <span className="mono">NEXT_PUBLIC_MARKET_ID</span> to point the app at a deployed
          market.
        </div>
      ) : (
        <div className="notice info">
          Connected to <span className="mono">{MARKET_ID}</span>. Opening a round means a
          NEP-141 <span className="mono">ft_transfer_call</span> carrying your maximum
          premium — see <a href="/rounds">rounds</a>.
        </div>
      )}

      <div className="footnote">
        Rainfall is NASA POWER <span className="mono">PRECTOTCORR</span> (Precipitation
        Corrected), daily, <span className="mono">community=AG</span>. Totals are computed in
        integers and rounded once, so every implementation agrees. One grid cell is roughly
        56 × 69 km near Enugu — rain on the cell is not rain on your farm, and that basis
        risk is inherent to index insurance.
      </div>
    </main>
  );
}
