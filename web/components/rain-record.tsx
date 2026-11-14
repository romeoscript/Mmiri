"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

export interface Season {
  season: number;
  mm_x10: number;
}

/** Axis ticks on 1/2/5×10ⁿ steps, so labels land on numbers people read. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/**
 * A bar whose data end is rounded and whose baseline end is square.
 *
 * A rect with `rx` rounds all four corners, which lifts the bar off its own baseline and
 * makes short bars read as floating lozenges. The radius belongs to the end that carries
 * the value, and it has to collapse on bars shorter than it or the corner eats the mark.
 */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x} ${y + h} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h} Z`;
}

/**
 * The rainfall record: one column per season against the strike that decides it.
 *
 * Two series by identity — a season that paid and one that did not — so a legend is
 * always present and colour is never the only cue: the short seasons also carry a marker
 * on the axis. The driest season is labelled directly; nothing else is, because a number
 * over every bar is noise rather than information.
 */
export function RainRecord({
  seasons,
  strike_mm_x10,
  siteName,
  windowLabel,
}: {
  seasons: Season[];
  strike_mm_x10: number;
  siteName: string;
  windowLabel: string;
}) {
  const root = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 1000;
  const H = 360;
  const padL = 54;
  const padR = 16;
  const padT = 30;
  const padB = 48;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const strikeMm = strike_mm_x10 / 10;
  const dataMax = Math.max(strikeMm, ...seasons.map((s) => s.mm_x10 / 10));
  const ticks = niceTicks(dataMax);
  const top = ticks[ticks.length - 1] ?? dataMax;
  const y = (mm: number) => padT + plotH - (mm / top) * plotH;
  const baseline = padT + plotH;

  const band = plotW / Math.max(seasons.length, 1);
  // A 2px surface gap between adjacent fills, which is what keeps them reading as
  // separate marks rather than one striped block.
  const barW = Math.max(3, band - 2);

  const dry = seasons.filter((s) => s.mm_x10 < strike_mm_x10);
  const strikeY = y(strikeMm);
  const hovered = hover === null ? null : seasons[hover];
  const driest = seasons.reduce(
    (a, b) => (b.mm_x10 < a.mm_x10 ? b : a),
    seasons[0] ?? { season: 0, mm_x10: 0 },
  );
  const driestIndex = seasons.indexOf(driest);

  const signature = `${siteName}|${strike_mm_x10}|${seasons.length}`;

  useEffect(() => {
    const svg = root.current;
    if (!svg) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      const bars = svg.querySelectorAll<SVGPathElement>("[data-bar]");
      const line = svg.querySelector<SVGLineElement>("[data-strike]");
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

      tl.from(bars, {
        scaleY: 0,
        svgOrigin: `0 ${baseline}`,
        duration: 0.55,
        stagger: { each: 0.012, from: "start" },
      });

      if (line) {
        tl.fromTo(
          line,
          { strokeDasharray: plotW, strokeDashoffset: plotW },
          { strokeDashoffset: 0, duration: 0.5, ease: "power1.inOut" },
          "-=0.25",
        );
      }
      tl.fromTo(
        svg.querySelectorAll("[data-late]"),
        { opacity: 0 },
        { opacity: 1, duration: 0.35, stagger: 0.03 },
        "-=0.15",
      );
    }, svg);

    return () => ctx.revert();
  }, [signature, baseline, plotW]);

  return (
    <figure className="rain-record">
      <div className="chart-wrap">
        <svg
          ref={root}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Rainfall total for each season at ${siteName}, ${windowLabel}, ${seasons[0]?.season} to ${
            seasons[seasons.length - 1]?.season
          }. ${dry.length} of ${seasons.length} seasons fell below the ${strikeMm.toFixed(1)} millimetre strike and would have paid. The full figures are in the table below the chart.`}
          onMouseLeave={() => setHover(null)}
        >
          {/* Grid sits under the marks and stays recessive. */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y(t)}
                y2={y(t)}
                className="grid-line"
              />
              <text x={padL - 10} y={y(t) + 4} textAnchor="end" className="axis-label">
                {t}
              </text>
            </g>
          ))}
          <text x={padL - 10} y={padT - 12} textAnchor="end" className="axis-unit">
            mm
          </text>

          {/* The shortfall region: everything the strike line sits above. */}
          <rect
            x={padL}
            y={strikeY}
            width={plotW}
            height={baseline - strikeY}
            fill="var(--chart-dry)"
            opacity="0.07"
          />

          {seasons.map((s, i) => {
            const mm = s.mm_x10 / 10;
            const isDry = s.mm_x10 < strike_mm_x10;
            const bx = padL + i * band + (band - barW) / 2;
            const by = y(mm);
            const bh = Math.max(1.5, baseline - by);
            const dim = hover !== null && hover !== i;
            return (
              <g key={s.season} onMouseEnter={() => setHover(i)}>
                <rect
                  x={padL + i * band}
                  y={padT}
                  width={band}
                  height={plotH}
                  fill="transparent"
                />
                <path
                  data-bar
                  d={barPath(bx, by, barW, bh)}
                  fill={isDry ? "var(--chart-dry)" : "var(--chart-wet)"}
                  opacity={dim ? 0.32 : 1}
                  style={{ transition: "opacity 140ms ease" }}
                />
                {isDry ? (
                  <circle
                    data-late
                    cx={bx + barW / 2}
                    cy={baseline + 12}
                    r="3"
                    fill="var(--chart-dry)"
                  />
                ) : null}
              </g>
            );
          })}

          {/* Selective direct label: the worst season, and nothing else. */}
          {driestIndex >= 0 ? (
            <g data-late>
              <text
                x={Math.min(
                  W - padR - 4,
                  Math.max(padL + 30, padL + driestIndex * band + band / 2),
                )}
                y={y(driest.mm_x10 / 10) - 10}
                textAnchor="middle"
                className="point-label"
              >
                {driest.season} · {(driest.mm_x10 / 10).toFixed(1)}
              </text>
            </g>
          ) : null}

          <line
            data-strike
            x1={padL}
            x2={W - padR}
            y1={strikeY}
            y2={strikeY}
            className="strike-line"
          />
          <text
            data-late
            x={W - padR}
            y={strikeY - 9}
            textAnchor="end"
            className="strike-label"
          >
            {strikeMm.toFixed(1)} mm strike
          </text>

          <line x1={padL} x2={W - padR} y1={baseline} y2={baseline} className="axis-line" />

          {seasons.map((s, i) =>
            s.season % 5 === 0 ? (
              <text
                key={`y${s.season}`}
                className="yr axis-label"
                x={padL + i * band + band / 2}
                y={H - 8}
                textAnchor="middle"
              >
                {s.season}
              </text>
            ) : null,
          )}
        </svg>

        {hovered ? (
          <div
            className="tip"
            style={{
              left: `${((padL + (hover! + 0.5) * band) / W) * 100}%`,
              top: `${(y(hovered.mm_x10 / 10) / H) * 100}%`,
            }}
          >
            <b>{hovered.season}</b>
            <span className="k">{(hovered.mm_x10 / 10).toFixed(1)} mm</span>
            <span className={hovered.mm_x10 < strike_mm_x10 ? "paid" : "no-pay"}>
              {hovered.mm_x10 < strike_mm_x10
                ? `${((strike_mm_x10 - hovered.mm_x10) / 10).toFixed(1)} mm short — paid`
                : "no payout"}
            </span>
          </div>
        ) : null}
      </div>

      <div className="legend">
        <span className="item">
          <span className="swatch" style={{ background: "var(--chart-dry)" }} />
          Below the strike — the policy pays
        </span>
        <span className="item">
          <span className="swatch" style={{ background: "var(--chart-wet)" }} />
          At or above — no payout
        </span>
      </div>

      <details className="chart-data">
        <summary>See the {seasons.length} figures behind this chart</summary>
        <div className="chart-data-body">
          <table>
            <caption className="small muted">
              Window total by season — {siteName}, {windowLabel}
            </caption>
            <thead>
              <tr>
                <th>Season</th>
                <th className="num">Total</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => (
                <tr key={s.season}>
                  <td>{s.season}</td>
                  <td className="num">{(s.mm_x10 / 10).toFixed(1)} mm</td>
                  <td>{s.mm_x10 < strike_mm_x10 ? "Paid" : "No payout"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
