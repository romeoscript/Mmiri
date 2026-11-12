/**
 * Server-side data loading.
 *
 * Everything here comes from files committed to the repository, so the app renders
 * fully without a wallet, without a deployed contract and without network access. That
 * matters for two reasons: a reviewer can open it and see real numbers immediately, and
 * the read-only views keep working when testnet does not.
 *
 * The rainfall fixture and the simulation results are the same files the tests and the
 * simulation use. Nothing is duplicated into the web app.
 */

import {
  breachCount,
  seasonTotals,
  strikeAtPercentile,
  type Fixture,
  type SeasonOutcome,
  type Site,
} from "@pricing";

// Imported rather than read from disk at runtime. Both files are committed, so a static
// import is honest about the dependency, lets the bundler trace exactly these two files
// instead of the whole repository, and means the pages cannot fail on a missing path.
import fixtureJson from "../../sim/fixtures/rainfall.json";
import resultsJson from "../../sim/results/results.json";

// ---------------------------------------------------------------------------
// Rainfall
// ---------------------------------------------------------------------------

export function fixture(): Fixture {
  return fixtureJson as unknown as Fixture;
}

export const SITE_ORDER = [
  "enugu",
  "nsukka",
  "ibadan",
  "makurdi",
  "kaduna",
  "kano",
  "sokoto",
  "maiduguri",
] as const;

export type SiteId = (typeof SITE_ORDER)[number];

export function sites(): { id: SiteId; site: Site }[] {
  const f = fixture();
  return SITE_ORDER.filter((id) => f.sites[id]).map((id) => ({ id, site: f.sites[id]! }));
}

export function site(id: string): Site | null {
  return fixture().sites[id] ?? null;
}

export function totalsFor(id: string, days = 30): SeasonOutcome[] {
  const s = site(id);
  return s ? seasonTotals(s, days) : [];
}

/** "30 days from 15 April" — from the stored MMDD, so it cannot drift from the data. */
export function windowLabel(s: Site, days = 30): string {
  const month = Number(s.window_start_mmdd.slice(0, 2));
  const day = Number(s.window_start_mmdd.slice(2, 4));
  const name = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][month - 1];
  return `${days} days from ${day} ${name}`;
}

/**
 * The honest headline for a quoted risk: how often this strike would have paid, and how
 * the long run disagrees with the recent past. That disagreement is the reason Mmiri runs
 * an auction instead of applying a formula.
 */
export function historyView(id: string, strike_mm_x10: number, season: number) {
  const totals = totalsFor(id);
  const all = breachCount(totals, strike_mm_x10, season);
  const recent = breachCount(totals, strike_mm_x10, season, 15);
  return {
    totals,
    all,
    recent,
    allRate: all.n ? all.k / all.n : 0,
    recentRate: recent.n ? recent.k / recent.n : 0,
  };
}

/** A sensible default strike for a site: the 20th percentile of its prior history. */
export function defaultStrike(id: string, season: number): number {
  return strikeAtPercentile(totalsFor(id), season, 20);
}

// ---------------------------------------------------------------------------
// Simulation results
// ---------------------------------------------------------------------------

export interface SimAgent {
  strategy: string;
  account: string;
  label: string;
  thesis: string;
  rounds_bid: number;
  rounds_won: number;
  rounds_declined: number;
  premiums_earned: string;
  claims_paid: string;
  loss_ratio: number | null;
  final_capital: string;
  profit: string;
  solvent: boolean;
}

export interface SimRound {
  season: number;
  round: number;
  buyer: string;
  site: string;
  terms: { start: number; days: number; strike_mm_x10: number; payout: string };
  bids: { strategy: string; premium: string | null; declined?: string; rate: number; loadBp: number }[];
  winner: string | null;
  clearing_premium: string | null;
  max_premium: string;
  observed_mm_x10: number;
  paid_out: boolean;
}

export interface SimResults {
  _meta: {
    seed: number;
    seasons: string;
    buyers: number;
    underwriters: number;
    sites: number;
    start_capital: string;
    max_premium_bp: number;
    strike_percentile_band: [number, number];
    fixture_pulled_at: string;
    generated_at: string;
    note: string;
  };
  summary: {
    rounds: number;
    rounds_cleared: number;
    rounds_no_bid: number;
    policies_paid_out: number;
    payout_rate: number;
  };
  agents: SimAgent[];
  rounds: SimRound[];
}

export function simResults(): SimResults | null {
  return resultsJson as unknown as SimResults;
}

/** Mean clearing price per season, for the line chart. */
export function clearingBySeason(r: SimResults) {
  const bySeason = new Map<number, { shares: number[]; cleared: number; paid: number }>();
  for (const round of r.rounds) {
    if (round.clearing_premium === null) continue;
    const e = bySeason.get(round.season) ?? { shares: [], cleared: 0, paid: 0 };
    e.shares.push(Number(round.clearing_premium) / Number(round.terms.payout));
    e.cleared += 1;
    if (round.paid_out) e.paid += 1;
    bySeason.set(round.season, e);
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, e]) => ({
      season,
      share: e.shares.reduce((a, b) => a + b, 0) / e.shares.length,
      cleared: e.cleared,
      paid: e.paid,
    }));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function usdc(v: string | bigint): string {
  const a = typeof v === "bigint" ? v : BigInt(v);
  const neg = a < 0n;
  const abs = neg ? -a : a;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${neg ? "−" : ""}${whole.toLocaleString("en-US")}.${frac}`;
}

export function mm(x10: number): string {
  return `${(x10 / 10).toFixed(1)} mm`;
}

export function yyyymmdd(d: number): string {
  const s = String(d);
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
}
