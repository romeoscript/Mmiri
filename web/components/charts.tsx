"use client";

/**
 * The two charts, as inline SVG.
 *
 * Both follow the data-viz method: thin marks, 4px rounded data-ends square at the
 * baseline, solid hairline grid, 2px lines with >=8px ringed markers, a hover layer, and
 * selective labels rather than a number on every point. Colours are the validated
 * palette — series blue for magnitude, status critical reserved for the one thing that is
 * genuinely a status (the window came in under the strike, so the policy pays).
 *
 * The threshold line is dashed. That is the one place dashing is correct: it marks an
 * actual threshold rather than decorating a gridline.
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// Rainfall history
// ---------------------------------------------------------------------------

export interface SeasonBar {
  season: number;
  mm_x10: number;
}

/**
 * Axis ticks whose top tick is always at or above `max`.
 *
 * The "at or above" is the whole point: an earlier version stopped at the last tick below
 * the maximum, so the tallest bar and the entire price line rendered outside their plot
 * areas and over the titles. Any tick scale that can be exceeded by its own data is a bug.
 */
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let i = 0; i <= 64; i++) {
    const v = step * i;
    out.push(v);
    if (v >= max - 1e-9) break;
  }
  return out;
}

/** Tick labels without trailing zeros, so a 2.5 step does not print as "2.50". */
function fmtTick(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

export function RainfallHistory({
  seasons,
  strike_mm_x10,
  siteName,
  windowLabel,
}: {
  seasons: SeasonBar[];
  strike_mm_x10: number;
  siteName: string;
  windowLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 860;
  const H = 300;
  const padL = 44;
  const padR = 14;
  // Headroom so the unit label clears the topmost tick instead of printing over it.
  const padT = 26;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxMm = Math.max(strike_mm_x10, ...seasons.map((s) => s.mm_x10)) / 10;
  const ticks = niceTicks(maxMm);
  const top = ticks[ticks.length - 1] ?? maxMm;
  const y = (mm: number) => padT + plotH - (mm / top) * plotH;

  const band = plotW / seasons.length;
  // 2px surface gap between adjacent bars; capped at 24px thick.
  const barW = Math.min(24, Math.max(3, band - 2));

  const breaches = seasons.filter((s) => s.mm_x10 < strike_mm_x10).length;
  const strikeY = y(strike_mm_x10 / 10);
  const hovered = hover === null ? null : seasons[hover];

  return (
    <div>
      <div className="chart-title">
        Rainfall in this window, {seasons[0]?.season}–{seasons[seasons.length - 1]?.season}
      </div>
      <div className="chart-sub">
        {siteName} · {windowLabel} · would have paid in <strong>{breaches} of {seasons.length}</strong>{" "}
        seasons
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={
          `Window rainfall total for ${siteName} by season, with a ${(strike_mm_x10 / 10).toFixed(1)} mm strike line. ` +
          `${breaches} of ${seasons.length} seasons fell below the strike.`
        }>
          {/* gridlines: solid hairlines, one step off the surface */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--grid)"
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={y(t) + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-muted)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {fmtTick(t)}
              </text>
            </g>
          ))}
          <text x={padL - 8} y={12} textAnchor="end" fontSize="11" fill="var(--text-muted)">
            mm
          </text>

          {/* bars */}
          {seasons.map((s, i) => {
            const mm = s.mm_x10 / 10;
            const bx = padL + i * band + (band - barW) / 2;
            const by = y(mm);
            const bh = Math.max(1, padT + plotH - by);
            const pays = s.mm_x10 < strike_mm_x10;
            const r = Math.min(4, barW / 2, bh);
            return (
              <g key={s.season}>
                {/* square at the baseline, 4px rounded at the data end */}
                <path
                  d={`M${bx},${by + bh} L${bx},${by + r} Q${bx},${by} ${bx + r},${by} L${bx + barW - r},${by} Q${bx + barW},${by} ${bx + barW},${by + r} L${bx + barW},${by + bh} Z`}
                  fill={pays ? "var(--status-critical)" : "var(--series-1)"}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
                {/* hit target wider than the mark */}
                <rect
                  x={padL + i * band}
                  y={padT}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}

          {/* the strike: an actual threshold, so dashed is right here */}
          <line
            x1={padL}
            x2={W - padR}
            y1={strikeY}
            y2={strikeY}
            stroke="var(--text-primary)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
          <text
            x={W - padR}
            y={strikeY - 6}
            textAnchor="end"
            fontSize="11.5"
            fill="var(--text-primary)"
            fontWeight="600"
          >
            {(strike_mm_x10 / 10).toFixed(1)} mm strike
          </text>

          {/* baseline */}
          <line
            x1={padL}
            x2={W - padR}
            y1={padT + plotH}
            y2={padT + plotH}
            stroke="var(--axis)"
            strokeWidth="1"
          />

          {/* every 5th season labelled, so nothing collides */}
          {seasons.map((s, i) =>
            s.season % 5 === 0 ? (
              <text
                key={s.season}
                x={padL + i * band + band / 2}
                y={H - padB + 16}
                textAnchor="middle"
                fontSize="11"
                fill="var(--text-muted)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {s.season}
              </text>
            ) : null,
          )}
        </svg>

        {hovered && hover !== null ? (
          <div
            className="tip"
            style={{
              left: `${((padL + hover * band + band / 2) / W) * 100}%`,
              top: `${(y(hovered.mm_x10 / 10) / H) * 100}%`,
            }}
          >
            <div>
              <span className="k">{hovered.season}</span>{" "}
              <b>{(hovered.mm_x10 / 10).toFixed(1)} mm</b>
            </div>
            <div className="k">
              {hovered.mm_x10 < strike_mm_x10 ? "would have paid" : "no payout"}
            </div>
          </div>
        ) : null}
      </div>

      <div className="legend">
        <span className="item">
          <span className="swatch" style={{ background: "var(--status-critical)" }} />
          below strike — policy pays
        </span>
        <span className="item">
          <span className="swatch" style={{ background: "var(--series-1)" }} />
          at or above strike — no payout
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clearing price over time
// ---------------------------------------------------------------------------

export interface ClearingPoint {
  season: number;
  /** Mean clearing premium as a share of payout, 0–1. */
  share: number;
  cleared: number;
  paid: number;
}

export function ClearingPrice({ points }: { points: ClearingPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 860;
  const H = 260;
  const padL = 44;
  const padR = 48;
  const padT = 14;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxPct = Math.max(...points.map((p) => p.share * 100), 10);
  const ticks = niceTicks(maxPct, 4);
  const top = ticks[ticks.length - 1] ?? maxPct;
  const y = (pct: number) => padT + plotH - (pct / top) * plotH;
  const x = (i: number) =>
    points.length === 1 ? padL + plotW / 2 : padL + (i / (points.length - 1)) * plotW;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.share * 100)}`).join(" ");
  const hovered = hover === null ? null : points[hover];
  const last = points[points.length - 1];

  return (
    <div>
      <div className="chart-title">Clearing price by season</div>
      <div className="chart-sub">
        Mean winning premium as a share of the payout, across cleared rounds. One series, so
        the title names it.
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={
          "Mean clearing premium as a percentage of payout, by season."
        }>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
              <text
                x={padL - 8}
                y={y(t) + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-muted)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {fmtTick(t)}%
              </text>
            </g>
          ))}

          {/* crosshair under the marks */}
          {hover !== null ? (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padT}
              y2={padT + plotH}
              stroke="var(--axis)"
              strokeWidth="1"
            />
          ) : null}

          <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {points.map((p, i) => (
            <circle
              key={p.season}
              cx={x(i)}
              cy={y(p.share * 100)}
              r="4"
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth="2"
            />
          ))}

          {/* selective direct label: the endpoint only */}
          {last ? (
            <text
              x={x(points.length - 1) + 10}
              y={y(last.share * 100) + 4}
              fontSize="12"
              fontWeight="600"
              fill="var(--text-primary)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {(last.share * 100).toFixed(1)}%
            </text>
          ) : null}

          <line
            x1={padL}
            x2={W - padR}
            y1={padT + plotH}
            y2={padT + plotH}
            stroke="var(--axis)"
            strokeWidth="1"
          />

          {points.map((p, i) =>
            i % 2 === 0 ? (
              <text
                key={p.season}
                x={x(i)}
                y={H - padB + 16}
                textAnchor="middle"
                fontSize="11"
                fill="var(--text-muted)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {p.season}
              </text>
            ) : null,
          )}

          {/* hit bands wider than the markers */}
          {points.map((p, i) => (
            <rect
              key={`h${p.season}`}
              x={i === 0 ? padL : x(i) - plotW / (points.length - 1) / 2}
              y={padT}
              width={plotW / Math.max(1, points.length - 1)}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>

        {hovered && hover !== null ? (
          <div
            className="tip"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              top: `${(y(hovered.share * 100) / H) * 100}%`,
            }}
          >
            <div>
              <span className="k">{hovered.season}</span>{" "}
              <b>{(hovered.share * 100).toFixed(1)}%</b> of payout
            </div>
            <div className="k">
              {hovered.paid} of {hovered.cleared} policies paid
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
