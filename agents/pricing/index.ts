/**
 * Underwriter pricing — the one implementation, used by both the live agents and the
 * offline simulation.
 *
 * Keeping it in a single module is the point: if the agents priced one way and the
 * backtest another, the simulation would be measuring something nobody is actually
 * running. RULES.md §5 is the specification.
 *
 * All money is `bigint` in USDC base units (6 decimals). Rates are exact rationals over
 * `bigint`, never floats — two implementations that round differently would quote
 * different premiums for the same risk, and the whole claim of this project is that the
 * price is reproducible.
 */

import { windowTotal } from "./rainfall.js";

export { windowTotal, paysOut, FILL } from "./rainfall.js";

/** 1 USDC. */
export const USDC = 1_000_000n;
/** Premiums are quantised to the cent, so base units always come in multiples of this. */
export const CENT = 10_000n;

// ---------------------------------------------------------------------------
// Risk description
// ---------------------------------------------------------------------------

export interface Terms {
  lat_e4: number;
  lon_e4: number;
  /** YYYYMMDD. */
  start: number;
  days: number;
  strike_mm_x10: number;
  payout: bigint;
}

export interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lat_e4: number;
  lon_e4: number;
  /** "0415" and so on. */
  window_start_mmdd: string;
  days_stored: number;
  first_season: number;
  last_season: number;
  /** Season year -> daily mm/day values from the window start. */
  seasons: Record<string, number[]>;
}

export interface Fixture {
  _source: Record<string, unknown>;
  sites: Record<string, Site>;
}

/** The NASA POWER half-degree cell a risk sits in. Concentration is measured per cell. */
export function cellOf(terms: Pick<Terms, "lat_e4" | "lon_e4">): string {
  const la = Math.floor(terms.lat_e4 / 5000);
  const lo = Math.floor(terms.lon_e4 / 5000);
  return `${la}:${lo}`;
}

/** Season year of a window, taken from its start date. */
export function seasonOf(start: number): number {
  return Math.floor(start / 10000);
}

// ---------------------------------------------------------------------------
// Exact rational arithmetic
// ---------------------------------------------------------------------------

export interface Rate {
  n: bigint;
  d: bigint;
}

/**
 * Laplace-smoothed breach rate: `(k + 1) / (n + 2)`.
 *
 * Not the raw `k / n`, and the difference is not cosmetic at these sample sizes. Seven
 * breaches in 45 seasons is a raw 15.6%, but with only 45 observations the honest estimate
 * of next season's probability is 17.0% — and a strike that has never once been breached
 * gets a small positive rate rather than a free policy. An underwriter quoting zero on an
 * unbreached strike is one bad season from insolvency.
 */
export function laplaceRate(k: number, n: number): Rate {
  return { n: BigInt(k + 1), d: BigInt(n + 2) };
}

export function rateAdd(a: Rate, b: Rate): Rate {
  return { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
}

export function rateHalve(a: Rate): Rate {
  return { n: a.n, d: a.d * 2n };
}

export function rateMax(a: Rate, b: Rate): Rate {
  return a.n * b.d >= b.n * a.d ? a : b;
}

export function rateToNumber(a: Rate): number {
  return Number(a.n) / Number(a.d);
}

/** Rounds a non-negative rational to the nearest integer, halves away from zero. */
function roundHalfUp(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface SeasonOutcome {
  season: number;
  mm_x10: number;
  days_valid: number;
}

/**
 * Window totals for every season of a site, computed from daily values.
 *
 * Totals are never stored pre-summed in the fixture: that would make the data
 * unverifiable and would freeze the window length at 30 days.
 */
export function seasonTotals(site: Site, days: number): SeasonOutcome[] {
  const out: SeasonOutcome[] = [];
  for (let y = site.first_season; y <= site.last_season; y++) {
    const daily = site.seasons[String(y)];
    if (!daily) continue;
    const { mm_x10, days_valid } = windowTotal(daily, days);
    out.push({ season: y, mm_x10, days_valid });
  }
  return out;
}

/**
 * Counts breaches among seasons that ended **before** the policy's season.
 *
 * The cutoff is what makes a backtest honest. An agent pricing the 2026 season may use
 * 1981–2025 and not one day more; a model that peeks at the season it is pricing will
 * look brilliant and tell you nothing.
 */
export function breachCount(
  totals: readonly SeasonOutcome[],
  strike_mm_x10: number,
  beforeSeason: number,
  lastN?: number,
): { k: number; n: number } {
  let usable = totals.filter((t) => t.season < beforeSeason && t.days_valid > 0);
  if (lastN !== undefined) usable = usable.slice(-lastN);
  const k = usable.filter((t) => t.mm_x10 < strike_mm_x10).length;
  return { k, n: usable.length };
}

/** The strike at a given percentile of a site's history before `beforeSeason`. */
export function strikeAtPercentile(
  totals: readonly SeasonOutcome[],
  beforeSeason: number,
  percentile: number,
): number {
  const usable = totals
    .filter((t) => t.season < beforeSeason && t.days_valid > 0)
    .map((t) => t.mm_x10)
    .sort((a, b) => a - b);
  if (usable.length === 0) return 0;
  const idx = Math.min(usable.length - 1, Math.floor((percentile / 100) * usable.length));
  return usable[idx]!;
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** How many recent seasons the "recent" view trusts. */
export const RECENT_WINDOW = 15;

export type StrategyId = "longrun" | "recent" | "blend" | "cautious" | "capacity";

export interface Book {
  /** Total capital the agent started with, in base units. */
  capital: bigint;
  /** Capital standing behind live policies. */
  locked: bigint;
  /** Live exposure per cell, keyed by `cellOf`, for the concentration check. */
  exposureByCell: Record<string, bigint>;
}

export function emptyBook(capital: bigint): Book {
  return { capital, locked: 0n, exposureByCell: {} };
}

export interface Strategy {
  id: StrategyId;
  /** Account suffix, e.g. `uw-1`. */
  account: string;
  label: string;
  /** One line on what this agent believes. Shown in the UI and the simulation table. */
  thesis: string;
  /** Combines the long-run and recent rates into the rate it will price on. */
  combine(longrun: Rate, recent: Rate): Rate;
  /** Load in basis points over expected loss, given the agent's current book. */
  loadBp(book: Book): bigint;
}

export const STRATEGIES: readonly Strategy[] = [
  {
    id: "longrun",
    account: "uw-1",
    label: "Longrun",
    thesis: "Every season since 1981 counts equally; the climate is noise around a mean.",
    combine: (longrun) => longrun,
    loadBp: () => 2000n,
  },
  {
    id: "recent",
    account: "uw-2",
    label: "Recent",
    thesis: "Only the last 15 seasons tell you anything; the old ones are a different climate.",
    combine: (_longrun, recent) => recent,
    loadBp: () => 2000n,
  },
  {
    id: "blend",
    account: "uw-3",
    label: "Blend",
    thesis: "Split the difference and charge a little more for not knowing which is right.",
    combine: (longrun, recent) => rateHalve(rateAdd(longrun, recent)),
    loadBp: () => 2500n,
  },
  {
    id: "cautious",
    account: "uw-4",
    label: "Cautious",
    thesis: "Price the worse of the two views. Survive first, compete second.",
    combine: (longrun, recent) => rateMax(longrun, recent),
    loadBp: () => 3500n,
  },
  {
    id: "capacity",
    account: "uw-5",
    label: "Capacity",
    thesis: "Blend the views, then ration the last of the capital by charging more for it.",
    combine: (longrun, recent) => rateHalve(rateAdd(longrun, recent)),
    // 20% on an empty book, rising toward 60% as it fills. A nearly full book quotes
    // nearly double, which is how a solvent underwriter rations its last capital rather
    // than selling it cheapest. Integer division, so the result is reproducible.
    loadBp: (book) =>
      book.capital === 0n ? 6000n : 2000n + (4000n * book.locked) / book.capital,
  },
] as const;

export function strategyById(id: StrategyId): Strategy {
  const s = STRATEGIES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown strategy ${id}`);
  return s;
}

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

/** Maximum share of an agent's capital allowed in one cell with overlapping windows. */
export const MAX_CELL_SHARE_BP = 3000n;

export interface Quote {
  strategy: StrategyId;
  /** Premium in USDC base units, quantised to the cent. `null` when declining. */
  premium: bigint | null;
  /** Why it declined, when it did. */
  declined?: "concentration" | "capital" | "no-history";
  /** The rate it priced on, for display. */
  rate: number;
  loadBp: number;
  k: number;
  n: number;
  kRecent: number;
  nRecent: number;
}

/**
 * Prices one risk for one agent against one site's history.
 *
 * Returns `premium: null` when the agent declines, which is a real market outcome rather
 * than an error: an underwriter that cannot carry a risk safely should not bid for it.
 */
export function quote(
  strategy: Strategy,
  terms: Terms,
  totals: readonly SeasonOutcome[],
  book: Book,
): Quote {
  const season = seasonOf(terms.start);
  const all = breachCount(totals, terms.strike_mm_x10, season);
  const rec = breachCount(totals, terms.strike_mm_x10, season, RECENT_WINDOW);

  const base = {
    strategy: strategy.id,
    rate: 0,
    loadBp: 0,
    k: all.k,
    n: all.n,
    kRecent: rec.k,
    nRecent: rec.n,
  };

  if (all.n === 0) {
    return { ...base, premium: null, declined: "no-history" };
  }

  const rate = strategy.combine(laplaceRate(all.k, all.n), laplaceRate(rec.k, rec.n));
  const loadBp = strategy.loadBp(book);

  // premium = payout x rate x (1 + load), rounded half-up to the cent.
  const payoutCents = terms.payout / CENT;
  const premiumCents = roundHalfUp(payoutCents * rate.n * (10_000n + loadBp), rate.d * 10_000n);
  const premium = premiumCents * CENT;

  const info = { ...base, rate: rateToNumber(rate), loadBp: Number(loadBp) };

  // Enough free capital to collateralise the whole payout? Cover is fully funded here,
  // not fractionally reserved, so this is a hard limit rather than a risk appetite.
  if (book.capital - book.locked < terms.payout) {
    return { ...info, premium: null, declined: "capital" };
  }

  // Concentration. A book of a hundred policies on one cell in one month is one policy,
  // and concentration is what kills an insurer long before total leverage does.
  const cell = cellOf(terms);
  const already = book.exposureByCell[cell] ?? 0n;
  if ((already + terms.payout) * 10_000n > book.capital * MAX_CELL_SHARE_BP) {
    return { ...info, premium: null, declined: "concentration" };
  }

  return { ...info, premium };
}

/** Every agent's quote for one risk, cheapest first. Declines sort last. */
export function quoteAll(
  terms: Terms,
  totals: readonly SeasonOutcome[],
  books: Record<StrategyId, Book>,
): Quote[] {
  return STRATEGIES.map((s) => quote(s, terms, totals, books[s.id])).sort((a, b) => {
    if (a.premium === null && b.premium === null) return 0;
    if (a.premium === null) return 1;
    if (b.premium === null) return -1;
    return a.premium < b.premium ? -1 : a.premium > b.premium ? 1 : 0;
  });
}

/** Formats base units as a USDC amount for display. */
export function fmtUsdc(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / USDC;
  const frac = (a % USDC).toString().padStart(6, "0").slice(0, 2);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}
