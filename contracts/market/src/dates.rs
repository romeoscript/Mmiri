//! Integer calendar arithmetic for YYYYMMDD window boundaries.
//!
//! Invariants 3 and 6 are both statements about time ("never before window end plus the
//! delay", "not a window that has already started"), so the contract has to turn a
//! YYYYMMDD into a timestamp it can compare against `block_timestamp`. There is no date
//! type in a NEAR contract and no reason to pull a crate for thirty lines of arithmetic.
//!
//! The conversion is Howard Hinnant's `days_from_civil`, which is exact for all
//! proleptic-Gregorian dates and uses only integer operations.

use near_sdk::require;

/// Days since 1970-01-01 for a proleptic Gregorian date. Exact, integer-only.
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = y - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = (m + 9) % 12; // March = 0
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Splits YYYYMMDD and rejects anything that is not a real date.
///
/// Rejecting rather than clamping matters: a silently coerced 20250230 would shift a
/// window by a day and settle against the wrong rainfall.
pub fn parse_yyyymmdd(start: u32) -> (i64, i64, i64) {
    let y = (start / 10_000) as i64;
    let m = ((start / 100) % 100) as i64;
    let d = (start % 100) as i64;
    require!(y >= 1900 && y <= 2200, "year out of range");
    require!(m >= 1 && m <= 12, "month out of range");
    require!(d >= 1 && d <= days_in_month(y, m), "day out of range for month");
    (y, m, d)
}

/// Unix seconds at 00:00 UTC on the given YYYYMMDD.
pub fn start_unix(start: u32) -> i64 {
    let (y, m, d) = parse_yyyymmdd(start);
    days_from_civil(y, m, d) * 86_400
}

/// Current block time in whole Unix seconds.
pub fn now_unix() -> i64 {
    (near_sdk::env::block_timestamp() / 1_000_000_000) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_and_known_dates() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(1969, 12, 31), -1);
        assert_eq!(days_from_civil(2000, 3, 1), 11017);
        // Leap-day handling either side of a century that is not a leap year.
        assert_eq!(days_from_civil(2000, 2, 29) + 1, days_from_civil(2000, 3, 1));
        assert_eq!(days_from_civil(1900, 2, 28) + 1, days_from_civil(1900, 3, 1));
    }

    #[test]
    fn window_arithmetic_matches_the_fixture_windows() {
        // Enugu 2025: 30 days from 15 April ends at 00:00 on 15 May.
        let start = start_unix(20250415);
        let end = start + 30 * 86_400;
        assert_eq!(end, start_unix(20250515));
        // And 2024 is a leap year, so the same arithmetic must still land on 15 May.
        assert_eq!(start_unix(20240415) + 30 * 86_400, start_unix(20240515));
    }

    #[test]
    fn leap_year_classification() {
        assert!(is_leap(2024));
        assert!(is_leap(2000));
        assert!(!is_leap(1900));
        assert!(!is_leap(2025));
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2025, 2), 28);
    }

    #[test]
    #[should_panic(expected = "day out of range for month")]
    fn rejects_impossible_date() {
        parse_yyyymmdd(20250230);
    }

    #[test]
    #[should_panic(expected = "month out of range")]
    fn rejects_impossible_month() {
        parse_yyyymmdd(20251315);
    }
}
