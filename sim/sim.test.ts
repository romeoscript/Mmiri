/**
 * Properties of the simulation itself.
 *
 * A backtest that quietly changes its answer, or that reports a profit its own ledger
 * does not support, is worse than no backtest. These tests run the real command — the
 * same one in the README — and check the output against itself.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const resultsPath = fileURLToPath(new URL("./results/results.json", import.meta.url));

interface Results {
  _meta: { seed: number; start_capital: string; max_premium_bp: number; generated_at: string };
  summary: {
    rounds: number;
    rounds_cleared: number;
    rounds_no_bid: number;
    policies_paid_out: number;
  };
  agents: {
    strategy: string;
    rounds_won: number;
    premiums_earned: string;
    claims_paid: string;
    final_capital: string;
    profit: string;
  }[];
  rounds: {
    season: number;
    winner: string | null;
    clearing_premium: string | null;
    max_premium: string;
    observed_mm_x10: number;
    paid_out: boolean;
    terms: { strike_mm_x10: number; payout: string };
    bids: { strategy: string; premium: string | null }[];
  }[];
}

function run(): Results {
  execFileSync("pnpm", ["sim"], { cwd: repoRoot, stdio: "pipe" });
  return JSON.parse(readFileSync(resultsPath, "utf8")) as Results;
}

let first: Results;

beforeAll(() => {
  first = run();
}, 120_000);

describe("determinism", () => {
  it("produces byte-identical results on a second run", () => {
    const second = run();
    // `generated_at` is a wall-clock stamp and is expected to differ; everything that
    // describes the market must not.
    const strip = (r: Results) => {
      const copy = JSON.parse(JSON.stringify(r)) as Results;
      copy._meta.generated_at = "";
      return JSON.stringify(copy);
    };
    expect(strip(second)).toBe(strip(first));
  }, 120_000);
});

describe("the ledger adds up", () => {
  it("gives every agent final capital = start + premiums - claims", () => {
    const start = BigInt(first._meta.start_capital);
    for (const a of first.agents) {
      const expected = start + BigInt(a.premiums_earned) - BigInt(a.claims_paid);
      expect(BigInt(a.final_capital), a.strategy).toBe(expected);
      expect(BigInt(a.profit), a.strategy).toBe(expected - start);
    }
  });

  it("accounts for every round as cleared or unbid", () => {
    expect(first.summary.rounds_cleared + first.summary.rounds_no_bid).toBe(
      first.summary.rounds,
    );
    expect(first.rounds).toHaveLength(first.summary.rounds);
    expect(first.rounds.filter((r) => r.winner !== null)).toHaveLength(
      first.summary.rounds_cleared,
    );
  });

  it("matches each agent's wins against the round records", () => {
    for (const a of first.agents) {
      const won = first.rounds.filter((r) => r.winner === a.strategy).length;
      expect(won, a.strategy).toBe(a.rounds_won);
    }
  });
});

describe("the auction rules are the contract's rules", () => {
  it("always clears at the lowest eligible bid", () => {
    for (const r of first.rounds) {
      const max = BigInt(r.max_premium);
      const eligible = r.bids
        .filter((b) => b.premium !== null && BigInt(b.premium) <= max)
        .map((b) => BigInt(b.premium!));
      if (eligible.length === 0) {
        expect(r.winner).toBeNull();
        continue;
      }
      const lowest = eligible.reduce((a, b) => (a < b ? a : b));
      expect(r.clearing_premium).not.toBeNull();
      expect(BigInt(r.clearing_premium!)).toBe(lowest);
    }
  });

  it("never clears above the buyer's maximum", () => {
    for (const r of first.rounds) {
      if (r.clearing_premium === null) continue;
      expect(BigInt(r.clearing_premium) <= BigInt(r.max_premium)).toBe(true);
    }
  });
});

describe("settlement follows the rain, not the ledger", () => {
  it("pays exactly the policies whose window came in under the strike", () => {
    for (const r of first.rounds) {
      if (r.winner === null) {
        expect(r.paid_out).toBe(false);
        continue;
      }
      const shouldPay = r.observed_mm_x10 < r.terms.strike_mm_x10;
      expect(r.paid_out, `season ${r.season} observed ${r.observed_mm_x10}`).toBe(shouldPay);
    }
  });

  it("counts the payouts it reports", () => {
    expect(first.rounds.filter((r) => r.paid_out)).toHaveLength(
      first.summary.policies_paid_out,
    );
  });
});

describe("the market actually discriminates", () => {
  it("writes real business across the fifteen seasons", () => {
    expect(first.summary.rounds).toBeGreaterThan(250);
    expect(first.summary.rounds_cleared).toBeGreaterThan(250);
    expect(first.summary.policies_paid_out).toBeGreaterThan(50);
  });

  it("punishes the agent that trusts the distant past", () => {
    // The whole argument of the project: Enugu's recent seasons breach far more often
    // than 45 years of history implies, so an underwriter pricing on the long run
    // underbids everyone, wins most of the market, and pays for it out of its own
    // capital. If this assertion ever fails, the mechanism has stopped demonstrating
    // anything and the README's claim needs rewriting.
    const longrun = first.agents.find((a) => a.strategy === "longrun")!;
    const recent = first.agents.find((a) => a.strategy === "recent")!;

    expect(longrun.rounds_won).toBeGreaterThan(recent.rounds_won);
    expect(BigInt(longrun.profit) < 0n).toBe(true);
    expect(BigInt(recent.profit) > BigInt(longrun.profit)).toBe(true);
  });
});
