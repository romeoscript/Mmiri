/**
 * The rainfall total, in integers.
 *
 * This is one of the two definitions that exist in more than one language (the other is
 * the commit hash). The oracle computes it in Rust on `wasm32-wasip2`, the simulation and
 * `scripts/verify-oracle` compute it here, and all three must agree exactly or a
 * settlement becomes unverifiable. RULES.md §6 is the specification.
 */

/** NASA POWER's missing-value marker. */
export const FILL = -999.0;

export interface WindowTotal {
  /** Window total in tenths of a mm. */
  mm_x10: number;
  /** Days in the window that were not the fill value. */
  days_valid: number;
}

/**
 * Sums a window of daily mm/day values into tenths of a mm.
 *
 * Two details carry the whole correctness argument:
 *
 *  - Each day is converted to **hundredths** and summed as an integer, and the result is
 *    rounded to tenths exactly **once**, at the end. Thirty per-day roundings drift by up
 *    to 1.5 mm, which is enough to flip a settlement near the strike.
 *  - Rounding is **half away from zero**, pinned rather than left to a language default.
 *    The tie case is real: Enugu 2025 sums to 5355 hundredths, exactly 535.5 tenths, and
 *    must come out as 536.
 *
 * NASA returns two decimal places, so the per-day conversion is exact and step two is the
 * only rounding anywhere in the process.
 */
export function windowTotal(daily: readonly number[], days: number): WindowTotal {
  let hundredths = 0;
  let days_valid = 0;
  for (let i = 0; i < days; i++) {
    const v = daily[i];
    if (v === undefined || v === FILL) continue;
    hundredths += Math.round(v * 100);
    days_valid += 1;
  }
  // Round half away from zero, once. Totals are never negative, so this is half-up.
  const mm_x10 = Math.floor((hundredths * 2 + 10) / 20);
  return { mm_x10, days_valid };
}

/** True when the window came in under the strike, i.e. the policy pays. */
export function paysOut(mm_x10: number, strike_mm_x10: number): boolean {
  return mm_x10 < strike_mm_x10;
}
