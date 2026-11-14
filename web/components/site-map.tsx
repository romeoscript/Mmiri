"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

export interface MapSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  window: string;
  dryRate: number;
}

/**
 * The eight sites, where they actually are.
 *
 * The country outline is a schematic — a recognisable silhouette, not survey data, and
 * it is labelled as such. The eight markers are not: each one is placed by the lat/lon
 * in `sim/fixtures/rainfall.json`, the same coordinates the oracle sends to NASA, so the
 * spread you see north to south is the real spread the market prices across.
 *
 * It is also a control. Clicking a marker reprices the whole page for that site, which
 * is why the markers are links rather than decoration.
 */

// (lon, lat) pairs tracing Nigeria, simplified for a silhouette at this size.
const OUTLINE: [number, number][] = [
  [3.6, 13.0], [4.1, 13.5], [5.4, 13.9], [6.8, 13.5], [8.5, 13.1], [9.6, 12.8],
  [11.0, 13.1], [12.5, 13.3], [13.1, 13.5], [14.0, 13.1], [14.6, 12.6], [14.2, 12.0],
  [13.6, 11.0], [13.0, 10.2], [12.8, 9.6], [13.3, 9.0], [12.6, 8.4], [12.2, 7.5],
  [11.6, 6.9], [11.1, 6.5], [10.5, 6.9], [9.8, 6.6], [9.0, 6.0], [8.6, 5.0],
  [8.3, 4.6], [7.5, 4.5], [6.7, 4.3], [5.9, 4.3], [5.4, 5.3], [5.0, 5.6],
  [4.3, 6.3], [3.4, 6.4], [2.7, 6.8], [2.8, 7.8], [2.7, 9.0], [3.5, 10.0],
  [3.6, 11.0], [3.6, 12.0],
];

const W = 460;
const H = 400;
const PAD = 26;
const LON = [2.4, 14.9] as const;
const LAT = [3.9, 14.3] as const;

const px = (lon: number) => PAD + ((lon - LON[0]) / (LON[1] - LON[0])) * (W - PAD * 2);
const py = (lat: number) => PAD + ((LAT[1] - lat) / (LAT[1] - LAT[0])) * (H - PAD * 2);

export function SiteMap({
  sites,
  selectedId,
  strike,
  payout,
}: {
  sites: MapSite[];
  selectedId: string;
  strike?: number;
  payout?: number;
}) {
  const root = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = root.current;
    if (!svg) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      const path = svg.querySelector<SVGPathElement>("[data-outline]");
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

      if (path) {
        const len = path.getTotalLength();
        tl.fromTo(
          path,
          { strokeDasharray: len, strokeDashoffset: len },
          { strokeDashoffset: 0, duration: 1.1, ease: "power1.inOut" },
        );
      }
      tl.fromTo(
        svg.querySelectorAll("[data-marker]"),
        { scale: 0, transformOrigin: "50% 50%" },
        { scale: 1, duration: 0.45, stagger: 0.06, ease: "back.out(2)" },
        "-=0.55",
      );
      // The selected site keeps breathing, so the map always says where you are.
      tl.to(
        svg.querySelector("[data-halo]"),
        { scale: 1.5, opacity: 0, duration: 1.8, repeat: -1, ease: "sine.out",
          transformOrigin: "50% 50%" },
        "-=0.1",
      );
    }, svg);

    return () => ctx.revert();
  }, [selectedId, sites.length]);

  const qs = (id: string) => {
    const p = new URLSearchParams({ site: id });
    if (strike) p.set("strike", String(strike));
    if (payout) p.set("payout", String(payout));
    return `/?${p.toString()}`;
  };

  const selected = sites.find((s) => s.id === selectedId);

  // Nsukka and Enugu are 45km apart, which at this scale puts their labels on top of one
  // another. Anything with a close neighbour drops its label below the marker if it is
  // the southern of the pair, so both stay readable without hand-placing every site.
  const labelDy = new Map<string, number>();
  for (const a of sites) {
    const near = sites.find(
      (b) =>
        b.id !== a.id &&
        Math.hypot(px(a.lon) - px(b.lon), py(a.lat) - py(b.lat)) < 30,
    );
    labelDy.set(a.id, near && a.lat < near.lat ? 22 : -13);
  }

  return (
    <div className="sitemap">
      <svg
        ref={root}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Schematic map of Nigeria with the ${sites.length} sites this market prices. ${
          selected ? `${selected.name} is selected.` : ""
        }`}
      >
        {/* graticule — this is a measured place, not an illustration */}
        {[4, 6, 8, 10, 12, 14].map((lat) => (
          <g key={`lat${lat}`}>
            <line x1={PAD} x2={W - PAD} y1={py(lat)} y2={py(lat)} className="grat" />
            <text x={4} y={py(lat) + 3} className="grat-label">
              {lat}°N
            </text>
          </g>
        ))}
        {[4, 6, 8, 10, 12, 14].map((lon) => (
          <line key={`lon${lon}`} y1={PAD} y2={H - PAD} x1={px(lon)} x2={px(lon)} className="grat" />
        ))}

        <path
          data-outline
          d={OUTLINE.map((p, i) => `${i ? "L" : "M"}${px(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`).join(" ") + " Z"}
          className="outline"
        />

        {sites.map((s) => {
          const x = px(s.lon);
          const y = py(s.lat);
          const on = s.id === selectedId;
          return (
            <a key={s.id} href={qs(s.id)} aria-label={`Price ${s.name}`}>
              <g data-marker className={on ? "marker is-on" : "marker"}>
                {on ? <circle data-halo cx={x} cy={y} r="9" className="halo" /> : null}
                <circle cx={x} cy={y} r={on ? 6 : 4} className="dot" />
                <text
                  x={x}
                  y={y + (labelDy.get(s.id) ?? -13)}
                  textAnchor="middle"
                  className="site-label"
                >
                  {s.name}
                </text>
                <title>
                  {s.name} — {s.window}, paid in {(s.dryRate * 100).toFixed(0)}% of seasons
                </title>
              </g>
            </a>
          );
        })}
      </svg>
      <p className="small muted sitemap-note">
        Markers sit at the coordinates the oracle sends to NASA. The country outline is a
        schematic. Pick one to reprice the page.
      </p>
    </div>
  );
}
