import { StatusChip } from "../page";
import { RainfallHistory } from "@/components/charts";
import { fixture, mm, totalsFor, usdc, windowLabel, yyyymmdd } from "@/lib/data";
import {
  MARKET_ID,
  contractConfigured,
  explorerAccount,
  getConfig,
  getPolicy,
} from "@/lib/near";
import { windowTotal } from "@pricing";

export const dynamic = "force-dynamic";

/** Finds the fixture site matching a policy's coordinates, so a reading can be rechecked. */
function siteForCoords(lat_e4: number, lon_e4: number) {
  const f = fixture();
  for (const [id, s] of Object.entries(f.sites)) {
    if (s.lat_e4 === lat_e4 && s.lon_e4 === lon_e4) return { id, site: s };
  }
  return null;
}

export default async function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!contractConfigured()) {
    return (
      <main>
        <h1>Policy #{id}</h1>
        <div className="notice">
          <strong>No contract is configured for this deployment.</strong> Set{" "}
          <span className="mono">NEXT_PUBLIC_MARKET_ID</span> to read policies from chain.
        </div>
      </main>
    );
  }

  const [policy, config] = await Promise.all([getPolicy(id), getConfig()]);

  if (!policy) {
    return (
      <main>
        <h1>Policy #{id}</h1>
        <div className="notice">
          No policy with that id on <span className="mono">{MARKET_ID}</span>.
        </div>
      </main>
    );
  }

  const match = siteForCoords(policy.terms.lat_e4, policy.terms.lon_e4);
  const season = Math.floor(policy.terms.start / 10000);

  // Independent recomputation from the committed fixture. This is the verify step: the
  // same integer algorithm the oracle runs, applied to data we did not fetch at settlement
  // time. If the two disagree, something is wrong and it is visible here.
  const recomputed =
    match && match.site.seasons[String(season)]
      ? windowTotal(match.site.seasons[String(season)]!, policy.terms.days)
      : null;

  const reading = policy.reading;
  const agrees = reading && recomputed ? reading.mm_x10 === recomputed.mm_x10 : null;

  const settleAt =
    Date.UTC(
      Math.floor(policy.terms.start / 10000),
      Math.floor((policy.terms.start % 10000) / 100) - 1,
      policy.terms.start % 100,
    ) /
      1000 +
    (policy.terms.days + (config?.settle_delay_days ?? 4)) * 86400;
  const canSettle = Date.now() / 1000 >= settleAt;

  return (
    <main>
      <h1>
        Policy #{policy.id} <StatusChip status={policy.status} settling={policy.settling} />
      </h1>
      <p className="lede">
        {usdc(policy.terms.payout)} USDC if rainfall at ({policy.terms.lat_e4 / 10000},{" "}
        {policy.terms.lon_e4 / 10000}) over {policy.terms.days} days from{" "}
        {yyyymmdd(policy.terms.start)} totals less than {mm(policy.terms.strike_mm_x10)}.
      </p>

      <div className="grid cols-4">
        <div className="tile">
          <div className="label">Held by</div>
          <div className="value" style={{ fontSize: 15, wordBreak: "break-all" }}>
            <a href={explorerAccount(policy.owner_id)} className="mono">
              {policy.owner_id}
            </a>
          </div>
          <div className="note">paid if the window comes in under the strike</div>
        </div>
        <div className="tile">
          <div className="label">Underwritten by</div>
          <div className="value" style={{ fontSize: 15, wordBreak: "break-all" }}>
            <a href={explorerAccount(policy.underwriter)} className="mono">
              {policy.underwriter}
            </a>
          </div>
          <div className="note">{usdc(policy.terms.payout)} USDC locked as collateral</div>
        </div>
        <div className="tile">
          <div className="label">Premium paid</div>
          <div className="value">{usdc(policy.premium)}</div>
          <div className="note">
            {((Number(policy.premium) / Number(policy.terms.payout)) * 100).toFixed(1)}% of
            the payout
          </div>
        </div>
        <div className="tile">
          <div className="label">Settlement</div>
          <div className="value" style={{ fontSize: 17 }}>
            {policy.status === "Active"
              ? canSettle
                ? "ready"
                : "waiting"
              : policy.status === "PaidOut"
                ? "paid"
                : "expired"}
          </div>
          <div className="note">
            {policy.status === "Active"
              ? `from ${new Date(settleAt * 1000).toISOString().slice(0, 10)}`
              : reading
                ? `${mm(reading.mm_x10)} observed`
                : "—"}
          </div>
        </div>
      </div>

      <h2>The reading</h2>
      {reading ? (
        <div className="card">
          <table>
            <tbody>
              <tr>
                <th>Window total</th>
                <td>
                  <strong>{mm(reading.mm_x10)}</strong> against a{" "}
                  {mm(policy.terms.strike_mm_x10)} strike —{" "}
                  {reading.mm_x10 < policy.terms.strike_mm_x10
                    ? "under, so the policy paid"
                    : "at or above, so it expired"}
                </td>
              </tr>
              <tr>
                <th>Days counted</th>
                <td>
                  {reading.days_valid} of {policy.terms.days}
                  <span className="muted small">
                    {" "}
                    — a partial window is rejected as a failed read, not treated as a dry one
                  </span>
                </td>
              </tr>
              <tr>
                <th>Source</th>
                <td>
                  {"OutLayer" in reading.source ? (
                    <>
                      <strong>OutLayer TEE</strong> — hash-pinned WASM. Execution{" "}
                      <span className="mono">
                        {reading.source.OutLayer.execution_ref || "(no reference returned)"}
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>Keeper</strong>{" "}
                      <span className="mono">{reading.source.Keeper.account_id}</span>
                      <div className="small muted">
                        In this mode the keeper is trusted: it could post a reading that is
                        not true. The recomputation below is what makes a dishonest reading
                        detectable by anyone — it does not prevent one.
                      </div>
                    </>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="notice">
          No reading yet. {policy.status === "Active" && !canSettle
            ? `Settlement opens on ${new Date(settleAt * 1000).toISOString().slice(0, 10)} — the window plus a ${config?.settle_delay_days ?? 4}-day delay, because NASA's near-real-time data lags about three days.`
            : "Anyone may settle this policy now."}
        </div>
      )}

      <h2>Check it yourself</h2>
      {recomputed ? (
        <div className={agrees === false ? "notice" : "notice info"}>
          Recomputed here from the committed rainfall fixture, with the same integer
          algorithm the oracle runs: <strong>{mm(recomputed.mm_x10)}</strong> over{" "}
          {recomputed.days_valid} valid days.
          {reading ? (
            agrees ? (
              <>
                {" "}
                That <strong>matches</strong> the reading stored on chain.
              </>
            ) : (
              <>
                {" "}
                That <strong>does not match</strong> the stored reading of{" "}
                {mm(reading.mm_x10)}. Either NASA has revised the figure since settlement, or
                something is wrong — the stored reading is final either way, which is a
                limitation stated in the README.
              </>
            )
          ) : null}
        </div>
      ) : (
        <div className="notice">
          This policy&rsquo;s coordinates are not in the committed fixture, so it cannot be
          rechecked offline. Run <span className="mono">pnpm verify-oracle {policy.id}</span>{" "}
          to recompute it against the live NASA POWER API.
        </div>
      )}

      {match ? (
        <div className="card">
          <RainfallHistory
            seasons={totalsFor(match.id).map((t) => ({ season: t.season, mm_x10: t.mm_x10 }))}
            strike_mm_x10={policy.terms.strike_mm_x10}
            siteName={`${match.site.name} (${match.site.lat}, ${match.site.lon})`}
            windowLabel={windowLabel(match.site)}
          />
        </div>
      ) : null}

      {policy.status === "Active" ? (
        <>
          <h2>Settle it</h2>
          <p className="small muted">
            Settlement is a function anyone may call — the holder does not have to know their
            policy came good, and cannot be denied by not knowing. This page does not sign
            transactions, so here is the call to make:
          </p>
          <div className="card">
            <p className="mono small" style={{ margin: 0, wordBreak: "break-all" }}>
              {config && config.oracle_wasm_url
                ? `near call ${MARKET_ID} settle '{"policy_id":"${policy.id}"}' --deposit 0.1 --accountId YOU.testnet`
                : `near call ${MARKET_ID} submit_observation '{"policy_id":"${policy.id}","mm_x10":${recomputed?.mm_x10 ?? 0},"days_valid":${recomputed?.days_valid ?? 0}}' --accountId ${config?.keeper_account ?? "KEEPER"}`}
            </p>
          </div>
          <p className="small muted">
            {config && config.oracle_wasm_url
              ? "The attached NEAR pays for the off-chain run and the unused part is refunded. A failed execution is not refunded, which is why the settle delay exists."
              : "This deployment has no oracle WASM configured, so it settles through the trusted keeper path. The README says which mode shipped."}
          </p>
        </>
      ) : null}

      <div className="footnote">
        Rainfall is NASA POWER <span className="mono">PRECTOTCORR</span>. The reading taken at
        settlement is final: NASA revises historical values, and a revision afterwards does
        not reopen a settled policy. One grid cell is roughly 56 × 69 km near Enugu, so rain
        measured on the cell is not rain that fell on any particular farm.
      </div>
    </main>
  );
}
