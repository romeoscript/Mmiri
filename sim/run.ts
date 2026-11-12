/**
 * Mmiri's offline market simulation.
 *
 *   pnpm sim
 *
 * No network, no keys, no LLM. Every number comes from the committed fixture and a fixed
 * seed, so two runs on two machines produce identical output.
 *
 * What it is for: the five underwriters disagree about how much the distant past tells
 * you about next season. That disagreement cannot be settled by argument, only by capital.
 * This runs fifteen seasons of real Nigerian rainfall through the same auction rules the
 * contract enforces and reports who was still solvent at the end.
 *
 * It uses the same pricing library the live agents use (`agents/pricing`), so it is not a
 * model of the market — it is the market, run against history.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  STRATEGIES,
  USDC,
  cellOf,
  fmtUsdc,
  paysOut,
  quote,
  seasonTotals,
  strikeAtPercentile,
  type Book,
  type Fixture,
  type SeasonOutcome,
  type StrategyId,
  type Terms,
} from "../agents/pricing/index.js";

// ---------------------------------------------------------------------------
// Parameters. All fixed: the point is reproducibility.
// ---------------------------------------------------------------------------

const SEED = 20261112;
const FIRST_SEASON = 2011;
const LAST_SEASON = 2025;
const BUYERS = 20;
const DAYS = 30;

/** Each underwriter's starting capital. */
const START_CAPITAL = 2_000n * USDC;

/** The most a buyer will pay, as a share of the payout. */
const MAX_PREMIUM_BP = 4_000n; // 40%

/** Buyers choose a strike in this percentile band of their site's prior history. */
const STRIKE_PCT_LOW = 15;
const STRIKE_PCT_HIGH = 25;

/** Explicit order so the run does not depend on object key iteration. */
const SITE_ORDER = [
  "enugu",
  "nsukka",
  "ibadan",
  "makurdi",
  "kaduna",
  "kano",
  "sokoto",
  "maiduguri",
] as const;

/** Payout sizes cycled across buyers, in USDC. */
const PAYOUT_LADDER = [30n, 50n, 50n, 80n] as const;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32). Seeded once, drawn in a fixed order.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Bid {
  strategy: StrategyId;
  premium: string | null;
  declined?: string;
  rate: number;
  loadBp: number;
}

interface RoundRecord {
  season: number;
  round: number;
  buyer: string;
  site: string;
  terms: { start: number; days: number; strike_mm_x10: number; payout: string };
  bids: Bid[];
  winner: StrategyId | null;
  clearing_premium: string | null;
  max_premium: string;
  /** What actually fell, in tenths of a mm. */
  observed_mm_x10: number;
  paid_out: boolean;
}

interface AgentResult {
  strategy: StrategyId;
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

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/rainfall.json", import.meta.url), "utf8"),
) as Fixture;

const totalsBySite = new Map<string, SeasonOutcome[]>();
for (const id of SITE_ORDER) {
  const site = fixture.sites[id];
  if (!site) throw new Error(`fixture is missing site ${id}`);
  totalsBySite.set(id, seasonTotals(site, DAYS));
}

const rand = mulberry32(SEED);

const books: Record<StrategyId, Book> = Object.fromEntries(
  STRATEGIES.map((s) => [s.id, { capital: START_CAPITAL, locked: 0n, exposureByCell: {} }]),
) as Record<StrategyId, Book>;

const tally: Record<
  StrategyId,
  { bid: number; won: number; declined: number; premiums: bigint; claims: bigint }
> = Object.fromEntries(
  STRATEGIES.map((s) => [s.id, { bid: 0, won: 0, declined: 0, premiums: 0n, claims: 0n }]),
) as never;

const rounds: RoundRecord[] = [];
let roundNo = 0;

for (let season = FIRST_SEASON; season <= LAST_SEASON; season++) {
  // Live policies written this season, settled at the end of it.
  const live: {
    strategy: StrategyId;
    terms: Terms;
    cell: string;
    siteId: string;
    /** Index into `rounds`, so settlement never has to search for its own record. */
    recordIdx: number;
  }[] = [];

  for (let b = 0; b < BUYERS; b++) {
    const siteId = SITE_ORDER[b % SITE_ORDER.length]!;
    const site = fixture.sites[siteId]!;
    const totals = totalsBySite.get(siteId)!;
    const payout = PAYOUT_LADDER[b % PAYOUT_LADDER.length]! * USDC;

    // Strike: a percentile of this site's history before this season. Drawn from the
    // seeded PRNG, so every run picks the same strikes.
    const pct = STRIKE_PCT_LOW + rand() * (STRIKE_PCT_HIGH - STRIKE_PCT_LOW);
    const strike_mm_x10 = strikeAtPercentile(totals, season, pct);
    if (strike_mm_x10 <= 0) continue;

    const start = Number(`${season}${site.window_start_mmdd}`);
    const terms: Terms = {
      lat_e4: site.lat_e4,
      lon_e4: site.lon_e4,
      start,
      days: DAYS,
      strike_mm_x10,
      payout,
    };
    const maxPremium = (payout * MAX_PREMIUM_BP) / 10_000n;

    // ---- the sealed-bid round -------------------------------------------
    // Every agent prices independently. The contract never sees a premium before the
    // reveal, so nobody here gets to look at a rival's number either.
    const quotes = STRATEGIES.map((s) => quote(s, terms, totals, books[s.id]));

    const bids: Bid[] = quotes.map((q) => ({
      strategy: q.strategy,
      premium: q.premium === null ? null : q.premium.toString(),
      ...(q.declined ? { declined: q.declined } : {}),
      rate: q.rate,
      loadBp: q.loadBp,
    }));

    for (const q of quotes) {
      if (q.premium === null) tally[q.strategy].declined += 1;
      else tally[q.strategy].bid += 1;
    }

    // Lowest premium at or under the buyer's maximum wins. Ties break on the earlier
    // commit, which here is the agent's fixed order — the same rule as RULES.md §4.
    const eligible = quotes.filter(
      (q): q is typeof q & { premium: bigint } => q.premium !== null && q.premium <= maxPremium,
    );
    eligible.sort((a, b2) => (a.premium < b2.premium ? -1 : a.premium > b2.premium ? 1 : 0));
    const won = eligible[0];

    const observed = totalsBySite.get(siteId)!.find((t) => t.season === season);
    const observed_mm_x10 = observed?.mm_x10 ?? -1;

    roundNo += 1;
    const record: RoundRecord = {
      season,
      round: roundNo,
      buyer: `buyer-${b + 1}`,
      site: siteId,
      terms: {
        start,
        days: DAYS,
        strike_mm_x10,
        payout: payout.toString(),
      },
      bids,
      winner: won?.strategy ?? null,
      clearing_premium: won ? won.premium.toString() : null,
      max_premium: maxPremium.toString(),
      observed_mm_x10,
      paid_out: false,
    };

    const recordIdx = rounds.push(record) - 1;

    if (won) {
      const book = books[won.strategy];
      const cell = cellOf(terms);
      book.locked += payout;
      book.exposureByCell[cell] = (book.exposureByCell[cell] ?? 0n) + payout;
      book.capital += won.premium;
      tally[won.strategy].won += 1;
      tally[won.strategy].premiums += won.premium;
      live.push({ strategy: won.strategy, terms, cell, siteId, recordIdx });
    }
  }

  // ---- settlement: the season happens, and the rain decides ----------------
  for (const policy of live) {
    const observed = totalsBySite.get(policy.siteId)!.find((t) => t.season === season);
    const book = books[policy.strategy];
    const payout = policy.terms.payout;

    // Collateral comes back either way; what differs is where it goes.
    book.locked -= payout;
    book.exposureByCell[policy.cell] = (book.exposureByCell[policy.cell] ?? 0n) - payout;

    if (observed && paysOut(observed.mm_x10, policy.terms.strike_mm_x10)) {
      book.capital -= payout;
      tally[policy.strategy].claims += payout;
      rounds[policy.recordIdx]!.paid_out = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

const results: AgentResult[] = STRATEGIES.map((s) => {
  const t = tally[s.id];
  const book = books[s.id];
  const profit = book.capital - START_CAPITAL;
  return {
    strategy: s.id,
    account: s.account,
    label: s.label,
    thesis: s.thesis,
    rounds_bid: t.bid,
    rounds_won: t.won,
    rounds_declined: t.declined,
    premiums_earned: t.premiums.toString(),
    claims_paid: t.claims.toString(),
    loss_ratio: t.premiums === 0n ? null : Number(t.claims) / Number(t.premiums),
    final_capital: book.capital.toString(),
    profit: profit.toString(),
    solvent: book.capital > 0n,
  };
});

const cleared = rounds.filter((r) => r.winner !== null);
const paid = rounds.filter((r) => r.paid_out);

const out = {
  _meta: {
    seed: SEED,
    seasons: `${FIRST_SEASON}-${LAST_SEASON}`,
    buyers: BUYERS,
    underwriters: STRATEGIES.length,
    sites: SITE_ORDER.length,
    days: DAYS,
    start_capital: START_CAPITAL.toString(),
    max_premium_bp: Number(MAX_PREMIUM_BP),
    strike_percentile_band: [STRIKE_PCT_LOW, STRIKE_PCT_HIGH],
    fixture_pulled_at: (fixture._source as Record<string, string>).pulled_at,
    generated_at: new Date().toISOString(),
    note:
      "Deterministic: same seed, same fixture, same output. No network and no LLM calls. " +
      "Pricing comes from agents/pricing, the same module the live agents use.",
  },
  summary: {
    rounds: rounds.length,
    rounds_cleared: cleared.length,
    rounds_no_bid: rounds.length - cleared.length,
    policies_paid_out: paid.length,
    payout_rate: cleared.length === 0 ? 0 : paid.length / cleared.length,
  },
  agents: results,
  rounds,
};

const path = new URL("./results/results.json", import.meta.url);
mkdirSync(dirname(path.pathname), { recursive: true });
writeFileSync(path, JSON.stringify(out, null, 1) + "\n");

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

console.log();
console.log("Mmiri — offline market simulation");
console.log(
  `  seasons ${FIRST_SEASON}–${LAST_SEASON} · ${SITE_ORDER.length} sites · ${BUYERS} buyers · ` +
    `${STRATEGIES.length} underwriters · seed ${SEED}`,
);
console.log(
  `  rainfall fixture pulled ${(fixture._source as Record<string, string>).pulled_at}` +
    "  (NASA POWER PRECTOTCORR)",
);
console.log();

console.log(
  "  " +
    pad("agent", 12) +
    padL("won", 5) +
    padL("bid", 5) +
    padL("decl", 6) +
    padL("premiums", 11) +
    padL("claims", 11) +
    padL("loss", 8) +
    padL("capital", 11) +
    padL("profit", 11),
);
console.log("  " + "-".repeat(80));
for (const r of results) {
  const loss = r.loss_ratio === null ? "   n/a" : `${(r.loss_ratio * 100).toFixed(0)}%`;
  console.log(
    "  " +
      pad(`${r.account} ${r.label}`, 12) +
      padL(String(r.rounds_won), 5) +
      padL(String(r.rounds_bid), 5) +
      padL(String(r.rounds_declined), 6) +
      padL(fmtUsdc(BigInt(r.premiums_earned)), 11) +
      padL(fmtUsdc(BigInt(r.claims_paid)), 11) +
      padL(loss, 8) +
      padL(fmtUsdc(BigInt(r.final_capital)), 11) +
      padL(fmtUsdc(BigInt(r.profit)), 11),
  );
}
console.log("  " + "-".repeat(80));
console.log(
  `  ${rounds.length} rounds · ${cleared.length} cleared · ` +
    `${rounds.length - cleared.length} found no bid · ${paid.length} paid out ` +
    `(${((paid.length / Math.max(1, cleared.length)) * 100).toFixed(0)}% of cleared)`,
);
console.log();

console.log("  Clearing price by season (mean premium as % of payout, cleared rounds only)");
for (let season = FIRST_SEASON; season <= LAST_SEASON; season++) {
  const rs = rounds.filter((r) => r.season === season && r.clearing_premium !== null);
  if (rs.length === 0) continue;
  const shares = rs.map(
    (r) => Number(BigInt(r.clearing_premium!)) / Number(BigInt(r.terms.payout)),
  );
  const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
  const paidThis = rs.filter((r) => r.paid_out).length;
  const bar = "#".repeat(Math.round(mean * 100));
  console.log(
    `    ${season}  ${padL((mean * 100).toFixed(1) + "%", 6)}  ${pad(bar, 42)} ` +
      `${paidThis}/${rs.length} paid`,
  );
}
console.log();

for (const r of results) {
  console.log(`  ${r.account} ${r.label}: ${r.thesis}`);
}
console.log();
console.log(`  Full detail, every round and every bid: sim/results/results.json`);
console.log();
