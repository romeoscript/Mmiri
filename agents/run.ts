#!/usr/bin/env tsx
/**
 * An underwriter agent.
 *
 *   pnpm agent uw-1 quote 3        what it would bid, and why
 *   pnpm agent uw-1 bid 3          seal and commit a premium
 *   pnpm agent uw-1 reveal 3       open the commitment
 *   pnpm agent all watch           all five, polling and acting on every open round
 *
 * Each agent is its own NEAR account with its own capital, and signs with a
 * **function-call key scoped to the market contract and to `commit_bid` and `reveal_bid`
 * only**. Not `withdraw`. A stolen agent key can place bad bids; it cannot take the
 * capital out. `scripts/print-key-permissions` reads that back off the chain.
 *
 * There is no LLM anywhere in here. Pricing is `agents/pricing`, the same module the
 * simulation runs, so the backtest measures the market that actually exists.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import { commitHash, newSalt } from "./commit";
import {
  STRATEGIES,
  USDC,
  cellOf,
  emptyBook,
  fmtUsdc,
  quote as priceIt,
  seasonTotals,
  type Book,
  type Fixture,
  type Quote,
  type Site,
  type Strategy,
  type Terms,
} from "./pricing/index";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
const PARENT = process.env.MMIRI_PARENT ?? "";
const MARKET = process.env.MMIRI_MARKET || (PARENT ? `market.${PARENT}` : "");

/** Where a salt lives between committing and revealing. Gitignored. */
const SALT_FILE = new URL("../.mmiri/salts.json", import.meta.url);

const GAS = 100_000_000_000_000n; // 100 Tgas

function keyFor(agent: string): string {
  const env = `${agent.toUpperCase().replace("-", "_")}_KEY`;
  const k = process.env[env];
  if (!k) {
    throw new Error(
      `${env} is not set. Run scripts/setup-agents, then put the function-call key in .env.`,
    );
  }
  return k;
}

let fixtureCache: Fixture | undefined;

/** Parsed once. It is 22,080 daily values, and all five agents read the same copy. */
function fixture(): Fixture {
  fixtureCache ??= JSON.parse(
    readFileSync(new URL("../sim/fixtures/rainfall.json", import.meta.url), "utf8"),
  ) as Fixture;
  return fixtureCache;
}

function siteForTerms(t: Terms): { id: string; site: Site } | null {
  const f = fixture();
  for (const [id, s] of Object.entries(f.sites)) {
    if (s.lat_e4 === t.lat_e4 && s.lon_e4 === t.lon_e4) return { id, site: s };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Salt storage
// ---------------------------------------------------------------------------

type Salts = Record<string, { salt: string; premium: string }>;

function readSalts(): Salts {
  try {
    return JSON.parse(readFileSync(SALT_FILE, "utf8")) as Salts;
  } catch {
    return {};
  }
}

/**
 * One read-modify-write for a whole batch.
 *
 * The agents commit concurrently, and five separate read-modify-writes would race and
 * drop salts. A commitment whose salt was lost can never be revealed, so it forfeits the
 * bond for nothing — which makes this the one place where a race actually costs money.
 */
function writeSalts(entries: { key: string; salt: string; premium: bigint }[]) {
  if (entries.length === 0) return;
  const all = readSalts();
  for (const e of entries) all[e.key] = { salt: e.salt, premium: e.premium.toString() };
  mkdirSync(new URL("../.mmiri/", import.meta.url), { recursive: true });
  writeFileSync(SALT_FILE, JSON.stringify(all, null, 1) + "\n");
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

const provider = new JsonRpcProvider({ url: RPC });

async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!MARKET) throw new Error("MMIRI_MARKET (or MMIRI_PARENT) is not set");
  return (await provider.callFunction({
    contractId: MARKET,
    method,
    args,
    blockQuery: { finality: "final" },
  })) as T;
}

function agentAccount(agent: string): Account {
  return new Account(`${agent}.${PARENT}`, provider, KeyPairSigner.fromSecretKey(keyFor(agent) as never));
}

interface ChainTerms {
  lat_e4: number;
  lon_e4: number;
  start: number;
  days: number;
  strike_mm_x10: number;
  payout: string;
}

interface ChainRound {
  id: string;
  buyer: string;
  terms: ChainTerms;
  max_premium: string;
  commit_deadline: string;
  reveal_deadline: string;
  phase: "Commit" | "Reveal" | "Settled" | "Refunded";
  commits: { bidder: string; revealed_premium: string | null }[];
}

interface ChainUnderwriter {
  free: string;
  locked: string;
}

interface ChainPolicy {
  underwriter: string;
  terms: ChainTerms;
  status: string;
}

// ---------------------------------------------------------------------------
// Pricing against live state
// ---------------------------------------------------------------------------

/** Rebuilds an agent's book from chain, so the concentration check uses real exposure. */
async function bookFor(agent: string): Promise<Book> {
  const id = `${agent}.${PARENT}`;
  const uw = await view<ChainUnderwriter | null>("get_underwriter", { account_id: id });
  const free = BigInt(uw?.free ?? "0");
  const locked = BigInt(uw?.locked ?? "0");
  const book: Book = { capital: free + locked, locked, exposureByCell: {} };

  const policies = await view<ChainPolicy[]>("get_policies", { limit: 200 });
  for (const p of policies) {
    if (p.underwriter !== id || p.status !== "Active") continue;
    const cell = cellOf({ lat_e4: p.terms.lat_e4, lon_e4: p.terms.lon_e4 });
    book.exposureByCell[cell] = (book.exposureByCell[cell] ?? 0n) + BigInt(p.terms.payout);
  }
  return book;
}

function strategyFor(agent: string): Strategy {
  const s = STRATEGIES.find((x) => x.account === agent);
  if (!s) throw new Error(`no strategy for ${agent}; expected one of uw-1..uw-5`);
  return s;
}

async function quoteFor(agent: string, round: ChainRound): Promise<Quote & { terms: Terms }> {
  const terms: Terms = {
    lat_e4: round.terms.lat_e4,
    lon_e4: round.terms.lon_e4,
    start: round.terms.start,
    days: round.terms.days,
    strike_mm_x10: round.terms.strike_mm_x10,
    payout: BigInt(round.terms.payout),
  };
  const match = siteForTerms(terms);
  if (!match) {
    return {
      ...priceIt(strategyFor(agent), terms, [], emptyBook(0n)),
      terms,
    };
  }
  const totals = seasonTotals(match.site, terms.days);
  const book = await bookFor(agent);
  return { ...priceIt(strategyFor(agent), terms, totals, book), terms };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdQuote(agent: string, roundId: string) {
  const round = await view<ChainRound | null>("get_round", { round_id: roundId });
  if (!round) throw new Error(`no round ${roundId}`);
  const q = await quoteFor(agent, round);
  const s = strategyFor(agent);

  console.log(`\n${agent} ${s.label} — round ${roundId}`);
  console.log(`  ${s.thesis}`);
  console.log(
    `  history: ${q.k}/${q.n} breaches all seasons, ${q.kRecent}/${q.nRecent} recent`,
  );
  console.log(`  rate ${(q.rate * 100).toFixed(2)}%  load ${(q.loadBp / 100).toFixed(0)}%`);
  if (q.premium === null) {
    console.log(`  DECLINES (${q.declined})`);
  } else {
    const max = BigInt(round.max_premium);
    console.log(
      `  would bid ${fmtUsdc(q.premium)} USDC  (buyer will pay up to ${fmtUsdc(max)})` +
        (q.premium > max ? "  — above the buyer's maximum, so it cannot win" : ""),
    );
  }
  console.log();
}

interface PreparedBid {
  agent: string;
  bidder: string;
  premium: bigint;
  salt: string;
  hash: string;
}

/** Prices a round and seals a premium. Reads only — nothing is written or sent. */
async function prepareBid(agent: string, roundId: string): Promise<PreparedBid | null> {
  const round = await view<ChainRound | null>("get_round", { round_id: roundId });
  if (!round) throw new Error(`no round ${roundId}`);
  const bidder = `${agent}.${PARENT}`;
  if (round.commits.some((c) => c.bidder === bidder)) {
    console.log(`${agent}: already committed to round ${roundId}`);
    return null;
  }
  const q = await quoteFor(agent, round);
  if (q.premium === null) {
    console.log(`${agent}: declines round ${roundId} (${q.declined})`);
    return null;
  }
  if (q.premium > BigInt(round.max_premium)) {
    console.log(
      `${agent}: would bid ${fmtUsdc(q.premium)}, above the buyer's ${fmtUsdc(BigInt(round.max_premium))} — not bidding`,
    );
    return null;
  }
  const salt = newSalt();
  return { agent, bidder, premium: q.premium, salt, hash: commitHash(roundId, q.premium, salt, bidder) };
}

/**
 * Commit sealed bids, all agents at once.
 *
 * Concurrent rather than one after another, for two reasons. The commit window is
 * `commit_seconds` wide — 60 by default — and five sequential round trips to testnet do
 * not reliably fit inside it: the later agents get "commit window has closed" and the
 * auction silently runs with half its bidders. And five independent underwriters racing
 * for the same risk is what the market actually is; a queue is an artefact of the script.
 *
 * Every salt is on disk before any commit is sent. A commitment whose salt was lost can
 * never be revealed and forfeits the bond, so that write is not allowed to depend on a
 * transaction that may still fail.
 */
async function cmdBid(agents: string[], roundId: string) {
  const prepared = (await Promise.all(agents.map((a) => prepareBid(a, roundId))))
    .filter((b): b is PreparedBid => b !== null);

  writeSalts(prepared.map((b) => ({ key: `${roundId}:${b.bidder}`, salt: b.salt, premium: b.premium })));

  const sent = await Promise.allSettled(
    prepared.map(async (b) => {
      await agentAccount(b.agent).callFunction({
        contractId: MARKET,
        methodName: "commit_bid",
        args: { round_id: roundId, hash: b.hash },
        gas: GAS,
      });
      console.log(`${b.agent}: committed to round ${roundId} (sealed ${fmtUsdc(b.premium)} USDC)`);
    }),
  );

  // One agent's failure is not the auction's: report it and let the rest stand.
  let failures = 0;
  sent.forEach((r, i) => {
    if (r.status === "rejected") {
      failures += 1;
      const agent = prepared[i]?.agent ?? "unknown";
      console.error(
        `${agent}: commit failed — ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
      );
    }
  });
  if (prepared.length > 0 && failures === prepared.length) {
    throw new Error(`every commit on round ${roundId} failed`);
  }
}

async function revealOne(agent: string, roundId: string, round: ChainRound) {
  const bidder = `${agent}.${PARENT}`;
  const stored = readSalts()[`${roundId}:${bidder}`];
  if (!stored) {
    console.log(`${agent}: no stored salt for round ${roundId} — nothing to reveal`);
    return;
  }
  const mine = round.commits.find((c) => c.bidder === bidder);
  if (!mine) {
    console.log(`${agent}: no commit on round ${roundId}`);
    return;
  }
  if (mine.revealed_premium !== null) {
    console.log(`${agent}: already revealed round ${roundId}`);
    return;
  }

  await agentAccount(agent).callFunction({
    contractId: MARKET,
    methodName: "reveal_bid",
    args: { round_id: roundId, premium: stored.premium, salt: stored.salt },
    gas: GAS,
  });
  console.log(`${agent}: revealed ${fmtUsdc(BigInt(stored.premium))} USDC on round ${roundId}`);
}

/**
 * Reveal, all agents at once. Concurrent for the same reason as committing: the reveal
 * window is as narrow as the commit window, and an unrevealed bid forfeits its bond.
 */
async function cmdReveal(agents: string[], roundId: string) {
  const round = await view<ChainRound | null>("get_round", { round_id: roundId });
  if (!round) throw new Error(`no round ${roundId}`);

  const sent = await Promise.allSettled(agents.map((a) => revealOne(a, roundId, round)));
  sent.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(
        `${agents[i] ?? "unknown"}: reveal failed — ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
      );
    }
  });
}

/** Acts on every open round: commits while it can, reveals once the window opens. */
async function cmdWatch(agents: string[], once: boolean) {
  for (;;) {
    const rounds = await view<ChainRound[]>("get_rounds", { limit: 50 });
    const now = Math.floor(Date.now() / 1000);

    for (const r of rounds) {
      if (r.phase === "Settled" || r.phase === "Refunded") continue;
      const commitOpen = now < Number(r.commit_deadline);
      const revealOpen = now >= Number(r.commit_deadline) && now < Number(r.reveal_deadline);

      try {
        if (commitOpen) await cmdBid(agents, r.id);
        else if (revealOpen) await cmdReveal(agents, r.id);
      } catch (e) {
        console.error(`round ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

// ---------------------------------------------------------------------------

function usage(): never {
  console.error(
    [
      "",
      "  pnpm agent <uw-1..uw-5|all> quote <round>",
      "  pnpm agent <uw-1..uw-5|all> bid <round>",
      "  pnpm agent <uw-1..uw-5|all> reveal <round>",
      "  pnpm agent <uw-1..uw-5|all> watch [--once]",
      "",
      "  Needs MMIRI_PARENT and the agents' function-call keys in .env;",
      "  scripts/setup-agents creates them.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

async function main() {
  const [who, cmd, arg] = process.argv.slice(2);
  if (!who || !cmd) usage();
  if (!PARENT) throw new Error("MMIRI_PARENT is not set (see .env.example)");

  const agents = who === "all" ? STRATEGIES.map((s) => s.account) : [who];

  switch (cmd) {
    case "quote":
      if (!arg) usage();
      for (const a of agents) await cmdQuote(a, arg);
      break;
    case "bid":
      if (!arg) usage();
      await cmdBid(agents, arg);
      break;
    case "reveal":
      if (!arg) usage();
      await cmdReveal(agents, arg);
      break;
    case "watch":
      await cmdWatch(agents, process.argv.includes("--once"));
      break;
    default:
      usage();
  }
}

main().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
