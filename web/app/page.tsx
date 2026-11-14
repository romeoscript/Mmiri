import { RainRecord } from "@/components/rain-record";
import { RainField } from "@/components/rain-field";
import { Reveal } from "@/components/reveal";
import { Choreography, CountUp } from "@/components/on-view";
import { SiteMap } from "@/components/site-map";
import { SiteControls } from "@/components/site-controls";
import { RequestCover } from "@/components/request-cover";
import {
  SITE_ORDER,
  defaultStrike,
  historyView,
  mm,
  site,
  sites,
  windowLabel,
} from "@/lib/data";
import { MARKET_ID, contractConfigured } from "@/lib/near";
import { STRATEGIES, USDC, emptyBook, fmtUsdc, quote } from "@pricing";

export const dynamic = "force-dynamic";

const SEASON = 2026;
const PAYOUTS = [30, 50, 80] as const;
const EXPLORER = "https://testnet.nearblocks.io/address";

// Kept short on purpose: these sit in ~170px columns, where a twenty-word sentence
// wraps to four characters-per-line short of readable.
const STEPS = [
  {
    title: "You ask for cover",
    body: "One place, one 30-day window, your maximum price — escrowed with the request.",
  },
  {
    title: "Agents bid blind",
    body: "Each underwriter submits a hash of its premium. No one can read a rival's bid.",
  },
  {
    title: "Bids are opened",
    body: "After the window closes, each reveals. The contract rechecks every hash.",
  },
  {
    title: "The lowest price wins",
    body: "Cheapest premium under your maximum takes the risk, and locks the full payout.",
  },
  {
    title: "Rainfall decides",
    body: "The oracle reads NASA. Below the strike the payout moves — no claim is filed.",
  },
];

const SETTLED = [
  {
    id: 7,
    outcome: "Paid out",
    reading: "53.6 mm",
    detail: "below the 60.0 mm strike — 50 USDC went to the holder",
    dry: true,
    source: "keeper",
  },
  {
    id: 9,
    outcome: "Paid out",
    reading: "53.6 mm",
    detail: "settled by an OutLayer worker inside a TEE, not a trusted account",
    dry: true,
    source: "OutLayer",
  },
  {
    id: 8,
    outcome: "Expired",
    reading: "113.7 mm",
    detail: "well above the strike — no payout, collateral released",
    dry: false,
    source: "keeper",
  },
];

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
  const dearest = quotes[quotes.length - 1];

  // Only seasons that ended before the one being quoted. Showing the outcome of the
  // season we are pricing would be exactly the hindsight the pricing refuses.
  const past = h.totals
    .filter((t) => t.season < SEASON)
    .map((t) => ({ season: t.season, mm_x10: t.mm_x10 }));

  const recentDry = past.filter((t) => t.season >= 2011 && t.mm_x10 < strike).length;
  const firstYear = past[0]?.season;
  const lastYear = past[past.length - 1]?.season;
  const driest = past.reduce((a, b) => (b.mm_x10 < a.mm_x10 ? b : a), past[0]!);

  // Each site's own long-run breach rate at its own default strike, for the map.
  const mapSites = sites().map(({ id, site: x }) => ({
    id,
    name: x.name,
    lat: x.lat,
    lon: x.lon,
    window: windowLabel(x),
    dryRate: historyView(id, defaultStrike(id, SEASON), SEASON).allRate,
  }));

  return (
    <main>
      <Choreography />
      <Reveal>
        <section className="hero">
          <RainField />
          <h1 className="display" data-animate>
            Rainfall cover,
            <br />
            priced by a market
          </h1>
          <p className="lede" data-animate>
            Assessing a two-hectare farm costs more than the policy is worth, so smallholders
            cannot buy drought cover. Mmiri removes the assessor: five underwriter agents bid
            against each other for the risk, and the rainfall record settles it.
          </p>
          <div className="btn-row" data-animate>
            <a className="btn btn-primary" href="#price">
              Get cover
            </a>
            <a className="btn btn-ghost" href="/simulation">
              See 15 seasons backtested
            </a>
          </div>
        </section>

        <section data-animate>
          <div className="panel">
            <div className="panel-head">
              <h3>Rainfall in this window, {firstYear}–{lastYear}</h3>
              <span className="meta">
                {s.name} ({s.lat}, {s.lon}) — {windowLabel(s)}
              </span>
            </div>
            <div className="panel-body flush">
              <RainRecord
                seasons={past}
                strike_mm_x10={strike}
                siteName={`${s.name} (${s.lat}, ${s.lon})`}
                windowLabel={windowLabel(s)}
              />
            </div>
          </div>
          <p className="verdict">
            <strong>
              {h.all.k} of {h.all.n} seasons
            </strong>{" "}
            since {firstYear} fell below {mm(strike)} and would have paid.{" "}
            {recentDry > 0 ? (
              <>
                <strong>
                  {recentDry} of those {h.all.k}
                </strong>{" "}
                happened since 2011.
              </>
            ) : null}
          </p>
        </section>
      </Reveal>

      <div className="band band-tint">
        <div className="band-inner">
          <dl className="ledger" data-reveal="deal">
            <div className="ledger-row is-dry">
              <dt>
                Seasons that would have paid
                <small>{s.name}, every season on record since {firstYear}</small>
              </dt>
              <dd>
                <CountUp value={h.all.k} />
                <span>of {h.all.n}</span>
              </dd>
            </div>
            <div className="ledger-row is-wet">
              <dt>
                Driest window in the record
                <small>{driest.season} — against a {mm(strike)} strike</small>
              </dt>
              <dd>
                <CountUp value={driest.mm_x10 / 10} decimals={1} />
                <span>mm</span>
              </dd>
            </div>
            <div className="ledger-row">
              <dt>
                Underwriters competing for the risk
                <small>each with its own capital, its own key, and its own read</small>
              </dt>
              <dd>
                <CountUp value={5} />
              </dd>
            </div>
            <div className="ledger-row">
              <dt>
                Policies settled on testnet
                <small>one of them by a TEE oracle reading NASA directly</small>
              </dt>
              <dd>
                <CountUp value={3} />
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <section>
        <h2 data-reveal="clip">How one round works</h2>
        <p className="lede">
          A sealed-bid auction, start to finish, in about two minutes on chain.
        </p>
        <div className="steps" data-reveal="deal">
          {STEPS.map((step) => (
            <div className="step" key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="band band-tint">
        <div className="band-inner">
          <div className="map-split">
            <div data-reveal="settle">
              <SiteMap
                sites={mapSites}
                selectedId={siteId}
                strike={undefined}
                payout={payoutUsdc}
              />
            </div>
            <div>
              <h2 data-reveal="clip">Eight places, eight different risks</h2>
              <p>
                Rainfall is local. {mapSites[0]?.name} and {mapSites[mapSites.length - 1]?.name}{" "}
                sit in different climates on the same map, and their windows do not even
                start in the same month — the south plants in April, the far north in June.
                A single national price would be wrong everywhere.
              </p>
              <p className="muted">
                The market prices each site on its own record, so the premium follows the
                place rather than the country. Pick one on the map and every figure on this
                page recomputes for it.
              </p>
              <div className="btn-row">
                <a className="btn btn-ghost" href="#price">
                  Change the terms
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section id="price">
        <h2 data-reveal="clip">Set your terms, then buy the cover</h2>
        <p className="lede">
          Change anything on the left and every figure recomputes from the committed
          rainfall record. The price on the right is what the market would charge you now.
        </p>

        <div className="buy-split">
        <div className="buy-config">
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

        <div className="panel" style={{ marginTop: "1.5rem" }}>
          <div className="panel-head">
            <h3>What the five agents would quote</h3>
            <span className="meta">
              {payoutUsdc} USDC payout — {mm(strike)} strike — {windowLabel(s)} {SEASON}
            </span>
          </div>
          <div className="panel-body" style={{ overflowX: "auto" }}>
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
                          <span className="chip" style={{ color: "var(--rain)" }}>
                            <span className="dot" />
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
        </div>

        </div>

        <aside className="buy-rail">
        <RequestCover
          terms={{
            lat_e4: s.lat_e4,
            lon_e4: s.lon_e4,
            start: Number(`${SEASON}${s.window_start_mmdd}`),
            days: 30,
            strike_mm_x10: strike,
            payout: payout.toString(),
          }}
          // Half the payout, the same ceiling scripts/demo uses. You pay the winning bid,
          // not this, and the rest comes back when the round clears.
          maxPremium={(payout / 2n).toString()}
          siteName={s.name}
          windowLabel={`${windowLabel(s)} ${SEASON}`}
          expectedPremium={best ? fmtUsdc(best.q.premium!) : null}
        />
        </aside>
        </div>

        {best && dearest ? (
          <div className="notice info">
            At these terms the market clears at{" "}
            <strong>{fmtUsdc(best.q.premium!)} USDC</strong> —{" "}
            {((Number(best.q.premium!) / Number(payout)) * 100).toFixed(1)}% of the payout —
            written by{" "}
            <strong>
              {best.st.account} {best.st.label}
            </strong>
            . The spread between cheapest and dearest is{" "}
            {fmtUsdc(dearest.q.premium! - best.q.premium!)} USDC, which is the price of the
            disagreement below.
          </div>
        ) : null}
      </section>

      <section>
        <h2 data-reveal="clip">Why this needs a market and not a formula</h2>
        <div className="readings cols-3">
          <div className="reading is-wet">
            <span className="value">{(h.allRate * 100).toFixed(1)}%</span>
            <span className="label">All seasons since {firstYear}</span>
            <span className="note">
              fell below {mm(strike)} in {h.all.k} of {h.all.n} seasons
            </span>
          </div>
          <div className="reading is-dry">
            <span className="value">{(h.recentRate * 100).toFixed(1)}%</span>
            <span className="label">Last 15 seasons</span>
            <span className="note">
              fell below {mm(strike)} in {h.recent.k} of {h.recent.n} seasons
            </span>
          </div>
          <div className="reading">
            <span className="value">
              {h.allRate > 0 ? `${(h.recentRate / h.allRate).toFixed(2)}×` : "—"}
            </span>
            <span className="label">The gap</span>
            <span className="note">
              how much more often it has happened lately than across the whole record
            </span>
          </div>
        </div>
        <p className="muted" style={{ marginTop: "1.75rem" }}>
          Both numbers are correct. They disagree, and the premium you should charge differs
          accordingly. No single formula can know which rate is right, because the question —
          how much does the distant past tell you about next season — is a real open question
          about a changing climate. So Mmiri does not pick. It runs an auction, and the
          underwriters that misprice the risk lose their own capital.
        </p>
      </section>

      <div className="band">
        <div className="band-inner">
          <h2 data-reveal="clip">Settled on testnet, not described</h2>
          <p className="lede">
            Every one of these is a transaction you can open and a reading you can recompute
            yourself with <span className="mono">pnpm verify-oracle</span>.
          </p>
          <div className="grid cols-3" data-reveal="deal">
            {SETTLED.map((p) => (
              <div className="panel" key={p.id}>
                <div className="panel-head">
                  <h3>Policy {p.id}</h3>
                  <span
                    className="chip"
                    style={{ color: p.dry ? "var(--dust)" : "var(--rain)" }}
                  >
                    <span className="dot" />
                    {p.outcome}
                  </span>
                </div>
                <div className="panel-body">
                  <span className="reading">
                    <span
                      className="value"
                      style={{ color: p.dry ? "var(--dust)" : "var(--rain)" }}
                    >
                      {p.reading}
                    </span>
                  </span>
                  <p className="small muted" style={{ marginTop: "0.6rem" }}>
                    {p.detail}. Settled via the {p.source} path.
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="btn-row">
            <a className="btn btn-ghost" href={`${EXPLORER}/market.mmiri-demo.testnet`}>
              Open the market contract
            </a>
          </div>
        </div>
      </div>

      {!contractConfigured() ? (
        <div className="notice">
          <strong>This build has no contract configured</strong>, so there is nothing to sign
          here. Everything above is computed from the committed rainfall fixture and the real
          pricing library. Set <span className="mono">NEXT_PUBLIC_MARKET_ID</span> to point it
          at the deployed market.
        </div>
      ) : (
        <div className="notice info">
          Connected to <span className="mono">{MARKET_ID}</span>. Opening a round means a
          NEP-141 <span className="mono">ft_transfer_call</span> carrying your maximum premium
          — see <a href="/rounds">rounds</a>.
        </div>
      )}

      <div className="footnote">
        Rainfall is NASA POWER <span className="mono">PRECTOTCORR</span> (Precipitation
        Corrected), daily, <span className="mono">community=AG</span>. Totals are computed in
        integers and rounded once, so every implementation agrees. One grid cell is roughly
        56 × 69 km near Enugu — rain on the cell is not rain on your farm, and that basis risk
        is inherent to index insurance.
      </div>
    </main>
  );
}
