"use client";

/**
 * Site / strike / payout picker.
 *
 * Writes its state into the URL rather than component state, so every view of the chart
 * is a link someone can send to somebody else. Filters sit in one row above the chart, as
 * the data-viz interaction rules ask.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export function SiteControls({
  sites,
  siteId,
  strike,
  payout,
  payouts,
}: {
  sites: { id: string; name: string; window: string }[];
  siteId: string;
  strike: number;
  payout: number;
  payouts: number[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  const set = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) next.set(k, v);
      // Changing the site changes which history the strike refers to, so a strike carried
      // over from another site would be meaningless. Drop it and let the server pick the
      // 20th-percentile default for the new site.
      if (patch.site) next.delete("strike");
      router.push(`/?${next.toString()}`);
    },
    [params, router],
  );

  const current = sites.find((s) => s.id === siteId);

  return (
    <div className="card">
      <div className="grid cols-3">
        <div>
          <label className="field" htmlFor="site">
            Place
          </label>
          <select
            id="site"
            value={siteId}
            onChange={(e) => set({ site: e.target.value })}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="small muted" style={{ marginTop: 4 }}>
            {current?.window}
          </div>
        </div>

        <div>
          <label className="field" htmlFor="strike">
            Strike — pay out if the window totals less than this
          </label>
          <select
            id="strike"
            value={String(strike)}
            onChange={(e) => set({ strike: e.target.value })}
          >
            {strikeChoices(strike).map((v) => (
              <option key={v} value={String(v)}>
                {(v / 10).toFixed(1)} mm
              </option>
            ))}
          </select>
          <div className="small muted" style={{ marginTop: 4 }}>
            Default is the 20th percentile of this site&rsquo;s prior seasons
          </div>
        </div>

        <div>
          <label className="field" htmlFor="payout">
            Payout
          </label>
          <select
            id="payout"
            value={String(payout)}
            onChange={(e) => set({ payout: e.target.value })}
          >
            {payouts.map((p) => (
              <option key={p} value={String(p)}>
                {p} USDC
              </option>
            ))}
          </select>
          <div className="small muted" style={{ marginTop: 4 }}>
            The winner locks this in full as collateral
          </div>
        </div>
      </div>
    </div>
  );
}

/** A band of strikes around the current one, in whole millimetres. */
function strikeChoices(current: number): number[] {
  const set = new Set<number>([current]);
  const base = Math.round(current / 100) * 100;
  for (let v = Math.max(100, base - 400); v <= base + 400; v += 100) set.add(v);
  return [...set].sort((a, b) => a - b);
}
