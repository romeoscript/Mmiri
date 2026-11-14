"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

export interface Season {
  season: number;
  mm_x10: number;
}

/**
 * The rainfall record, as the page's opening image.
 *
 * Every season in the fixture is one column; the strike is the line across them. The
 * argument this product exists to make is a shape, not a number — seven seasons fell
 * short, and four of those seven are recent — and that shape is only visible if you draw
 * the whole distribution. A headline with three stat tiles cannot say it.
 *
 * The load sequence is the one piece of unprompted motion on the site: columns fill from
 * the baseline left to right the way a season accumulates, the strike line draws across,
 * and only then do the short seasons turn to dust. Everything after that answers a
 * pointer. Reduced motion skips straight to the end state.
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
  const H = 330;
  const padL = 6;
  const padR = 6;
  const padT = 34;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const strikeMm = strike_mm_x10 / 10;
  const top = Math.ceil(Math.max(strikeMm, ...seasons.map((s) => s.mm_x10 / 10)) / 50) * 50 || 50;
  const y = (mm: number) => padT + plotH - (mm / top) * plotH;
  const baseline = padT + plotH;

  const band = plotW / Math.max(seasons.length, 1);
  const barW = Math.max(3, band - Math.max(2, band * 0.26));

  const dry = seasons.filter((s) => s.mm_x10 < strike_mm_x10);
  const strikeY = y(strikeMm);
  const hovered = hover === null ? null : seasons[hover];

  // Re-keyed on the data so changing site or strike replays the fill rather than
  // snapping: the chart redrawing is the answer to the control the visitor just moved.
  const signature = `${siteName}|${strike_mm_x10}|${seasons.length}`;

  useEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const bars = svg.querySelectorAll<SVGRectElement>("[data-bar]");
    const line = svg.querySelector<SVGLineElement>("[data-strike]");
    const lineLabel = svg.querySelector<SVGGElement>("[data-strike-label]");

    // The markup already renders the finished chart, so there is nothing to restore.
    if (reduced) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

      tl.fromTo(
        bars,
        { attr: { y: baseline, height: 0 } },
        {
          attr: {
            y: (i, t: SVGRectElement) => t.dataset.y as string,
            height: (i, t: SVGRectElement) => t.dataset.h as string,
          },
          duration: 0.55,
          stagger: { each: 0.012, from: "start" },
        },
      );

      if (line) {
        const len = plotW;
        tl.fromTo(
          line,
          { strokeDasharray: len, strokeDashoffset: len, opacity: 1 },
          { strokeDashoffset: 0, duration: 0.5, ease: "power1.inOut" },
          "-=0.25",
        );
      }
      if (lineLabel) {
        tl.fromTo(lineLabel, { opacity: 0 }, { opacity: 1, duration: 0.25 }, "-=0.1");
      }

      // The short seasons declare themselves last, once the line they fell under exists.
      tl.fromTo(
        svg.querySelectorAll("[data-dry]"),
        { opacity: 0 },
        { opacity: 1, duration: 0.4, stagger: 0.035 },
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
          aria-label={`Rainfall total for each season at ${siteName}, ${windowLabel}, from ${seasons[0]?.season} to ${
            seasons[seasons.length - 1]?.season
          }. ${dry.length} of ${seasons.length} seasons fell below the ${strikeMm.toFixed(1)} millimetre strike and would have paid.`}
          onMouseLeave={() => setHover(null)}
        >
          {/* The strike line, and the band of shortfall beneath it. */}
          <rect
            x={padL}
            y={strikeY}
            width={plotW}
            height={baseline - strikeY}
            fill="var(--dust)"
            opacity="0.06"
          />

          {seasons.map((s, i) => {
            const mm = s.mm_x10 / 10;
            const isDry = s.mm_x10 < strike_mm_x10;
            const bx = padL + i * band + (band - barW) / 2;
            const by = y(mm);
            const bh = Math.max(1, baseline - by);
            return (
              <g key={s.season} onMouseEnter={() => setHover(i)}>
                {/* A full-height target so thin bars stay hoverable. */}
                <rect
                  x={padL + i * band}
                  y={padT}
                  width={band}
                  height={plotH}
                  fill="transparent"
                />
                <rect
                  data-bar
                  data-y={by}
                  data-h={bh}
                  x={bx}
                  y={by}
                  width={barW}
                  height={bh}
                  rx="1"
                  fill={isDry ? "var(--dust)" : "var(--rain)"}
                  opacity={hover === null || hover === i ? (isDry ? 1 : 0.72) : 0.3}
                  style={{ transition: "opacity 140ms ease" }}
                />
                {isDry ? (
                  <circle
                    data-dry
                    cx={bx + barW / 2}
                    cy={baseline + 11}
                    r="2.5"
                    fill="var(--dust)"
                  />
                ) : null}
              </g>
            );
          })}

          <line
            data-strike
            x1={padL}
            x2={W - padR}
            y1={strikeY}
            y2={strikeY}
            stroke="var(--paper)"
            strokeWidth="1.5"
          />
          <g data-strike-label>
            <text
              x={W - padR}
              y={strikeY - 9}
              textAnchor="end"
              fill="var(--paper)"
              fontSize="15"
              fontWeight="650"
            >
              {strikeMm.toFixed(1)} mm strike
            </text>
          </g>

          <line
            x1={padL}
            x2={W - padR}
            y1={baseline}
            y2={baseline}
            stroke="var(--rule-strong)"
            strokeWidth="1"
          />

          {/* One anchor for the scale. Without it the columns only say "above" or
              "below", and a reader cannot tell a near miss from a total failure. */}
          <text x={padL} y={padT - 12} fill="var(--silt)" fontSize="14">
            {top} mm
          </text>

          {seasons.map((s, i) =>
            s.season % 5 === 0 ? (
              <text
                key={`y${s.season}`}
                className="yr"
                x={padL + i * band + band / 2}
                y={H - 6}
                textAnchor="middle"
                fill="var(--silt)"
                fontSize="14"
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
            <b>{hovered.season}</b>{" "}
            <span className="k">{(hovered.mm_x10 / 10).toFixed(1)} mm</span>
            {hovered.mm_x10 < strike_mm_x10 ? (
              <>
                {" "}
                <span style={{ color: "var(--dust)" }}>paid</span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </figure>
  );
}
