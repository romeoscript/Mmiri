//! The oracle's logic, with no I/O in it.
//!
//! Everything here runs on the host as well as under WASI, so the arithmetic that decides
//! whether a farmer gets paid is covered by ordinary `cargo test` rather than only by
//! running a Wasm component. The binary in `main.rs` adds exactly one thing: the HTTP
//! fetch.
//!
//! The window total is specified in `docs/RULES.md` §6 and is implemented three times —
//! here in Rust for the oracle, in TypeScript for the simulation and the web app, and in
//! `scripts/verify-oracle` for anyone checking a settlement. All three must agree
//! exactly, which is why it is integer arithmetic with the rounding pinned.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// NASA POWER's missing-value marker.
pub const FILL: f64 = -999.0;

/// What the contract sends on stdin.
#[derive(Debug, Clone, Deserialize)]
pub struct Input {
    pub lat_e4: i32,
    pub lon_e4: i32,
    /// First day of the window, YYYYMMDD.
    pub start: u32,
    pub days: u16,
}

/// What we print on stdout. Must stay under 900 bytes (a NEAR limit); this is about 70.
#[derive(Debug, Clone, Serialize)]
pub struct Output {
    pub mm_x10: u32,
    pub days_valid: u16,
    pub source: &'static str,
}

pub const SOURCE: &str = "NASA POWER PRECTOTCORR";

/// The shape of the slice of NASA's response we care about.
#[derive(Debug, Deserialize)]
pub struct NasaResponse {
    pub properties: NasaProperties,
    #[serde(default)]
    pub header: Option<NasaHeader>,
}

#[derive(Debug, Deserialize)]
pub struct NasaProperties {
    pub parameter: NasaParameter,
}

#[derive(Debug, Deserialize)]
pub struct NasaParameter {
    #[serde(rename = "PRECTOTCORR")]
    pub prectotcorr: BTreeMap<String, f64>,
}

#[derive(Debug, Deserialize)]
pub struct NasaHeader {
    pub fill_value: Option<f64>,
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

fn is_leap(y: u32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: u32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(y) => 29,
        2 => 28,
        _ => 0,
    }
}

/// The day after a YYYYMMDD. Panics on an impossible date rather than coercing one:
/// a silently shifted window would settle against the wrong rainfall.
pub fn next_day(d: u32) -> u32 {
    let (y, m, day) = (d / 10_000, (d / 100) % 100, d % 100);
    assert!((1..=12).contains(&m), "bad month in {d}");
    let dim = days_in_month(y, m);
    assert!(day >= 1 && day <= dim, "bad day in {d}");
    if day < dim {
        d + 1
    } else if m < 12 {
        (y * 10_000) + ((m + 1) * 100) + 1
    } else {
        ((y + 1) * 10_000) + 101
    }
}

/// The YYYYMMDD keys of a window, in order.
pub fn window_days(start: u32, days: u16) -> Vec<u32> {
    let mut out = Vec::with_capacity(days as usize);
    let mut d = start;
    for _ in 0..days {
        out.push(d);
        d = next_day(d);
    }
    out
}

/// The exact URL the oracle fetches. Public so `scripts/verify-oracle` and a human can
/// rebuild it and check the raw numbers.
pub fn nasa_url(input: &Input) -> String {
    let days = window_days(input.start, input.days);
    let end = *days.last().unwrap_or(&input.start);
    format!(
        "https://power.larc.nasa.gov/api/temporal/daily/point\
?parameters=PRECTOTCORR&community=AG&latitude={}&longitude={}&start={}&end={}&format=JSON",
        fmt_e4(input.lat_e4),
        fmt_e4(input.lon_e4),
        input.start,
        end
    )
}

/// Degrees from an integer scaled by 10,000, without a trailing-zero tail.
fn fmt_e4(v: i32) -> String {
    let neg = v < 0;
    let a = v.unsigned_abs();
    let whole = a / 10_000;
    let frac = a % 10_000;
    let mut s = if frac == 0 {
        format!("{whole}")
    } else {
        format!("{whole}.{:04}", frac).trim_end_matches('0').to_string()
    };
    if neg {
        s.insert(0, '-');
    }
    s
}

// ---------------------------------------------------------------------------
// The total
// ---------------------------------------------------------------------------

/// Sums a window into tenths of a mm.
///
/// Each day is converted to hundredths and summed as an integer; the total is rounded to
/// tenths exactly once, half away from zero. Rounding per day instead would drift by up
/// to 1.5 mm over thirty days, which is enough to flip a settlement near the strike.
///
/// A day equal to the fill value is skipped and does **not** count as valid, so an
/// incomplete window reports fewer valid days rather than looking artificially dry.
pub fn window_total(daily: &BTreeMap<String, f64>, start: u32, days: u16) -> Output {
    let mut hundredths: i64 = 0;
    let mut days_valid: u16 = 0;

    for d in window_days(start, days) {
        match daily.get(&d.to_string()) {
            Some(v) if *v != FILL => {
                // Values are non-negative here, so "half away from zero" and "half up"
                // coincide; both the TypeScript and the verify script do the same.
                hundredths += (v * 100.0).round() as i64;
                days_valid += 1;
            }
            _ => {}
        }
    }

    let mm_x10 = ((hundredths * 2 + 10) / 20).max(0) as u32;
    Output { mm_x10, days_valid, source: SOURCE }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, f64)]) -> BTreeMap<String, f64> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn walks_a_window_across_a_month_boundary() {
        let days = window_days(20250430, 3);
        assert_eq!(days, vec![20250430, 20250501, 20250502]);
    }

    #[test]
    fn walks_across_a_year_boundary_and_a_leap_day() {
        assert_eq!(next_day(20251231), 20260101);
        assert_eq!(next_day(20240228), 20240229);
        assert_eq!(next_day(20250228), 20250301);
        assert_eq!(next_day(21000228), 21000301); // 2100 is not a leap year
    }

    #[test]
    fn enugu_2025_is_536() {
        // The real daily values for Enugu, 30 days from 15 April 2025, as returned by
        // NASA POWER. They sum to 5355 hundredths — exactly 535.5 tenths — so this is the
        // tie case, and it must round up to 536. Rounding per day would give 537.
        let vals = [
            0.67, 0.45, 0.21, 0.21, 0.27, 0.26, 0.52, 11.64, 6.16, 0.25, 0.84, 5.97, 2.34,
            2.03, 9.43, 1.35, 0.43, 0.27, 0.13, 0.06, 0.29, 0.51, 1.21, 2.04, 1.29, 1.34,
            0.64, 0.66, 1.05, 1.03,
        ];
        let days = window_days(20250415, 30);
        let daily: BTreeMap<String, f64> =
            days.iter().zip(vals.iter()).map(|(d, v)| (d.to_string(), *v)).collect();

        let out = window_total(&daily, 20250415, 30);
        assert_eq!(out.mm_x10, 536);
        assert_eq!(out.days_valid, 30);
    }

    #[test]
    fn fill_values_are_skipped_and_not_counted_valid() {
        let daily = map(&[("20250415", 1.0), ("20250416", FILL), ("20250417", 2.0)]);
        let out = window_total(&daily, 20250415, 3);
        assert_eq!(out.mm_x10, 30);
        assert_eq!(out.days_valid, 2);
    }

    #[test]
    fn missing_days_are_not_counted_valid() {
        // A day absent from the response is as invalid as an explicit fill value.
        let daily = map(&[("20250415", 1.0)]);
        let out = window_total(&daily, 20250415, 3);
        assert_eq!(out.days_valid, 1);
    }

    #[test]
    fn url_matches_the_one_a_human_would_build() {
        let input = Input { lat_e4: 64500, lon_e4: 75100, start: 20250415, days: 30 };
        assert_eq!(
            nasa_url(&input),
            "https://power.larc.nasa.gov/api/temporal/daily/point\
?parameters=PRECTOTCORR&community=AG&latitude=6.45&longitude=7.51&start=20250415&end=20250514&format=JSON"
        );
    }

    #[test]
    fn formats_negative_and_whole_coordinates() {
        assert_eq!(fmt_e4(-11830), "-1.183");
        assert_eq!(fmt_e4(120000), "12");
        assert_eq!(fmt_e4(64500), "6.45");
    }

    #[test]
    fn output_fits_well_inside_the_900_byte_limit() {
        let out = Output { mm_x10: 1137, days_valid: 30, source: SOURCE };
        let json = serde_json::to_string(&out).unwrap();
        assert!(json.len() < 900, "output was {} bytes: {json}", json.len());
        assert_eq!(
            json,
            r#"{"mm_x10":1137,"days_valid":30,"source":"NASA POWER PRECTOTCORR"}"#
        );
    }
}
