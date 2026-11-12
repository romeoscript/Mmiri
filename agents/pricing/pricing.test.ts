/**
 * The pricing library against the committed fixture. Offline, no network.
 *
 * The ten premium vectors below are the heart of the suite. They were computed from live
 * NASA POWER data and then reproduced here from the frozen fixture, so a change that
 * alters any quote by a single cent fails this file. That matters because the premium is
 * the product: if pricing drifts silently, the simulation measures a market nobody is
 * running.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  USDC,
  breachCount,
  cellOf,
  emptyBook,
  fmtUsdc,
  laplaceRate,
  quote,
  rateToNumber,
  seasonTotals,
  strategyById,
  windowTotal,
  type Fixture,
  type Terms,
} from "./index.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../sim/fixtures/rainfall.json", import.meta.url), "utf8"),
) as Fixture;

const enugu = fixture.sites.enugu!;
const totals = seasonTotals(enugu, 30);

function totalFor(season: number): number {
  const t = totals.find((x) => x.season === season);
  if (!t) throw new Error(`no season ${season}`);
  return t.mm_x10;
}

const PAYOUT = 50n * USDC;

function enuguTerms(start: number): Terms {
  return {
    lat_e4: 64500,
    lon_e4: 75100,
    start,
    days: 30,
    strike_mm_x10: 600,
    payout: PAYOUT,
  };
}

describe("rainfall totals", () => {
  it("reproduces the verified Enugu windows from the fixture", () => {
    // Pulled from NASA POWER on 2026-11-12 and checked against the live API.
    expect(totalFor(2019)).toBe(323);
    expect(totalFor(2023)).toBe(344);
    expect(totalFor(2025)).toBe(536);
    expect(totalFor(2026)).toBe(1137);
  });

  it("counts all 30 days as valid, with no fill values anywhere in the fixture", () => {
    for (const [id, site] of Object.entries(fixture.sites)) {
      for (const t of seasonTotals(site, 30)) {
        expect(t.days_valid, `${id} ${t.season}`).toBe(30);
      }
    }
  });

  it("rounds the half-case up, once, at the end", () => {
    // Enugu 2025 sums to exactly 535.5 tenths. Rounding per day instead would give 537,
    // and rounding half-down would give 535. Both would be wrong settlements.
    const daily = enugu.seasons["2025"]!;
    const raw = daily.slice(0, 30).reduce((a, b) => a + Math.round(b * 100), 0);
    expect(raw).toBe(5355);
    expect(windowTotal(daily, 30).mm_x10).toBe(536);
  });

  it("skips fill values without counting them valid", () => {
    const { mm_x10, days_valid } = windowTotal([1.0, -999.0, 2.0], 3);
    expect(mm_x10).toBe(30);
    expect(days_valid).toBe(2);
  });
});

describe("breach counts", () => {
  it("matches the figures the project is premised on", () => {
    // 60 mm strike, pricing the 2026 season: 1981-2025 inclusive.
    const all = breachCount(totals, 600, 2026);
    expect(all).toEqual({ k: 7, n: 45 });

    const recent = breachCount(totals, 600, 2026, 15);
    expect(recent).toEqual({ k: 4, n: 15 });

    // The disagreement that makes a market necessary: 15.6% against 26.7%.
    expect(all.k / all.n).toBeCloseTo(0.1556, 4);
    expect(recent.k / recent.n).toBeCloseTo(0.2667, 4);
  });

  it("uses only seasons that ended before the one being priced", () => {
    // Pricing 2025 must not see 2025, which breached.
    expect(breachCount(totals, 600, 2025)).toEqual({ k: 6, n: 44 });
    expect(breachCount(totals, 600, 2025, 15)).toEqual({ k: 3, n: 15 });
  });
});

describe("laplace smoothing", () => {
  it("is (k+1)/(n+2), not k/n", () => {
    expect(rateToNumber(laplaceRate(7, 45))).toBeCloseTo(8 / 47, 10);
    // The raw rate would price Longrun at 9.13 rather than 10.21 -- which is why RULES.md
    // pins this and why the vectors below only reproduce one way.
    expect(rateToNumber(laplaceRate(7, 45))).not.toBeCloseTo(7 / 45, 4);
  });

  it("gives a never-breached strike a positive rate", () => {
    // A strike so low it has never been hit still costs something to carry.
    expect(rateToNumber(laplaceRate(0, 45))).toBeGreaterThan(0);
  });
});

describe("premium vectors", () => {
  // 50 USDC payout, 60.0 mm strike, Enugu, 30 days from 15 April.
  const expected2026: Record<string, string> = {
    longrun: "10.21",
    recent: "17.65",
    blend: "14.51",
    cautious: "19.85",
    capacity: "13.93",
  };
  const expected2025: Record<string, string> = {
    longrun: "9.13",
    recent: "14.12",
    blend: "12.11",
    cautious: "15.88",
    capacity: "11.62",
  };

  for (const [id, want] of Object.entries(expected2026)) {
    it(`${id} quotes ${want} for 2026 priced on 1981-2025`, () => {
      const q = quote(
        strategyById(id as never),
        enuguTerms(20260415),
        totals,
        emptyBook(1000n * USDC),
      );
      expect(q.premium).not.toBeNull();
      expect(fmtUsdc(q.premium!)).toBe(want);
    });
  }

  for (const [id, want] of Object.entries(expected2025)) {
    it(`${id} quotes ${want} for 2025 priced on 1981-2024`, () => {
      const q = quote(
        strategyById(id as never),
        enuguTerms(20250415),
        totals,
        emptyBook(1000n * USDC),
      );
      expect(q.premium).not.toBeNull();
      expect(fmtUsdc(q.premium!)).toBe(want);
    });
  }

  it("quantises every premium to the cent", () => {
    for (const s of ["longrun", "recent", "blend", "cautious", "capacity"] as const) {
      const q = quote(strategyById(s), enuguTerms(20260415), totals, emptyBook(1000n * USDC));
      expect(q.premium! % 10_000n).toBe(0n);
    }
  });

  it("orders the agents as the market should: Longrun cheapest, Cautious dearest", () => {
    const book = emptyBook(1000n * USDC);
    const premiums = (["longrun", "capacity", "blend", "recent", "cautious"] as const).map(
      (s) => quote(strategyById(s), enuguTerms(20260415), totals, book).premium!,
    );
    for (let i = 1; i < premiums.length; i++) {
      expect(premiums[i]! > premiums[i - 1]!).toBe(true);
    }
  });
});

describe("capacity load", () => {
  it("rises from 20% toward 60% as the book fills", () => {
    const capacity = strategyById("capacity");
    const terms = enuguTerms(20260415);
    const capital = 1000n * USDC;

    const empty = quote(capacity, terms, totals, { capital, locked: 0n, exposureByCell: {} });
    const half = quote(capacity, terms, totals, {
      capital,
      locked: capital / 2n,
      exposureByCell: {},
    });

    expect(empty.loadBp).toBe(2000);
    expect(half.loadBp).toBe(4000);
    // A half-full book quotes meaningfully more for the same risk.
    expect(half.premium! > empty.premium!).toBe(true);
  });
});

describe("declining to bid", () => {
  const terms = enuguTerms(20260415);

  it("declines when it cannot collateralise the payout", () => {
    const q = quote(strategyById("blend"), terms, totals, emptyBook(10n * USDC));
    expect(q.premium).toBeNull();
    expect(q.declined).toBe("capital");
  });

  it("declines when one cell would exceed 30% of capital", () => {
    const capital = 100n * USDC;
    // 25 USDC already on this cell; another 50 would take it to 75% of capital.
    const q = quote(strategyById("blend"), terms, totals, {
      capital,
      locked: 25n * USDC,
      exposureByCell: { [cellOf(terms)]: 25n * USDC },
    });
    expect(q.premium).toBeNull();
    expect(q.declined).toBe("concentration");
  });

  it("still bids when the exposure sits on a different cell", () => {
    // Capital has to be large enough that the new policy is itself under the cap: a
    // 50 USDC payout is 50% of a 100 USDC book, so that book declines on concentration
    // whatever else it holds. 500 USDC puts this risk at 10%.
    const capital = 500n * USDC;
    const q = quote(strategyById("blend"), terms, totals, {
      capital,
      locked: 25n * USDC,
      exposureByCell: { "99:99": 25n * USDC },
    });
    expect(q.premium).not.toBeNull();
  });

  it("applies the cap to the new policy too, not only to what is already held", () => {
    // An empty book still declines a risk that would put more than 30% on one cell.
    const q = quote(strategyById("blend"), terms, totals, emptyBook(100n * USDC));
    expect(q.premium).toBeNull();
    expect(q.declined).toBe("concentration");
  });

  it("declines with no usable history", () => {
    // Pricing the very first season there is: nothing ended before it.
    const q = quote(
      strategyById("longrun"),
      enuguTerms(19810415),
      totals,
      emptyBook(1000n * USDC),
    );
    expect(q.premium).toBeNull();
    expect(q.declined).toBe("no-history");
  });
});

describe("fixture provenance", () => {
  it("records where the data came from and when", () => {
    const src = fixture._source as Record<string, string>;
    expect(src.parameter).toBe("PRECTOTCORR");
    expect(src.units).toBe("mm/day");
    expect(src.fill_value).toBe(-999);
    expect(typeof src.pulled_at).toBe("string");
    expect(Object.keys(fixture.sites)).toHaveLength(8);
  });
});
