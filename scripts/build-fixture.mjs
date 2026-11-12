#!/usr/bin/env node
// Builds sim/fixtures/rainfall.json from the NASA POWER daily point API.
//
// Run:  node scripts/build-fixture.mjs
//
// This is the ONLY part of Mmiri that touches the network during development.
// The committed fixture it produces is the source of truth for `cargo test`,
// the pricing unit tests and the simulation, all of which run offline.
//
// NASA revises historical values, so re-running this may shift a figure by
// 0.1 mm. That is why the fixture is committed rather than fetched at test
// time, and why it records its own pull date.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE = "https://power.larc.nasa.gov/api/temporal/daily/point";
const PARAM = "PRECTOTCORR";
const COMMUNITY = "AG";
const FILL = -999.0;

// First and last calendar day pulled per site.
const HIST_START = "19810101";
const HIST_END = "20261031";

// Days of daily values stored per season, from the window start. The product
// sells 30-day windows; 60 gives headroom to model a longer window later
// without another network pull.
const DAYS_STORED = 60;

const SITES = [
  { id: "enugu",     name: "Enugu",     lat: 6.45,  lon: 7.51,  windowStart: "0415" },
  { id: "nsukka",    name: "Nsukka",    lat: 6.86,  lon: 7.39,  windowStart: "0415" },
  { id: "ibadan",    name: "Ibadan",    lat: 7.38,  lon: 3.95,  windowStart: "0415" },
  { id: "makurdi",   name: "Makurdi",   lat: 7.73,  lon: 8.52,  windowStart: "0515" },
  { id: "kaduna",    name: "Kaduna",    lat: 10.52, lon: 7.44,  windowStart: "0515" },
  { id: "kano",      name: "Kano",      lat: 12.00, lon: 8.52,  windowStart: "0615" },
  { id: "sokoto",    name: "Sokoto",    lat: 13.06, lon: 5.24,  windowStart: "0615" },
  { id: "maiduguri", name: "Maiduguri", lat: 11.83, lon: 13.15, windowStart: "0615" },
];

const FIRST_SEASON = 1981;
const LAST_SEASON = 2026;

function url(site) {
  const p = new URLSearchParams({
    parameters: PARAM,
    community: COMMUNITY,
    latitude: String(site.lat),
    longitude: String(site.lon),
    start: HIST_START,
    end: HIST_END,
    format: "JSON",
  });
  return `${BASE}?${p}`;
}

function addDays(yyyymmdd, n) {
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6), d = +yyyymmdd.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`;
}

async function fetchSite(site) {
  const u = url(site);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`${site.id}: HTTP ${res.status}`);
  const body = await res.json();
  const daily = body?.properties?.parameter?.[PARAM];
  if (!daily) throw new Error(`${site.id}: no ${PARAM} in response`);
  const fill = body?.header?.fill_value;
  if (fill !== FILL) throw new Error(`${site.id}: unexpected fill_value ${fill}`);
  return { url: u, daily, units: body?.parameters?.[PARAM]?.units };
}

const out = {
  _source: {
    api: "NASA POWER daily point",
    docs: "https://power.larc.nasa.gov/docs/services/api/temporal/daily/",
    parameter: PARAM,
    parameter_longname: "Precipitation Corrected",
    community: COMMUNITY,
    units: "mm/day",
    fill_value: FILL,
    pulled_at: new Date().toISOString(),
    history_start: HIST_START,
    history_end: HIST_END,
    days_stored_per_season: DAYS_STORED,
    note:
      "Daily values are stored as returned (mm/day, 2 decimal places). Window totals are " +
      "recomputed from these by the shared integer algorithm in docs/RULES.md, never stored " +
      "pre-summed. NASA revises historical values; this fixture is the frozen source of truth " +
      "for all offline tests.",
    urls: {},
  },
  sites: {},
};

let totalDays = 0, totalFills = 0;

for (const site of SITES) {
  process.stderr.write(`fetching ${site.id} ... `);
  const { url: u, daily, units } = await fetchSite(site);
  out._source.urls[site.id] = u;
  if (units && units !== "mm/day") throw new Error(`${site.id}: units ${units}`);

  const seasons = {};
  for (let year = FIRST_SEASON; year <= LAST_SEASON; year++) {
    const start = `${year}${site.windowStart}`;
    const vals = [];
    for (let i = 0; i < DAYS_STORED; i++) {
      const key = addDays(start, i);
      const v = daily[key];
      vals.push(v === undefined ? FILL : v);
    }
    const fills = vals.filter((v) => v === FILL).length;
    totalDays += vals.length;
    totalFills += fills;
    seasons[year] = vals;
  }

  out.sites[site.id] = {
    name: site.name,
    lat: site.lat,
    lon: site.lon,
    // Degrees x 10,000, matching the contract's Terms encoding.
    lat_e4: Math.round(site.lat * 10000),
    lon_e4: Math.round(site.lon * 10000),
    window_start_mmdd: site.windowStart,
    days_stored: DAYS_STORED,
    first_season: FIRST_SEASON,
    last_season: LAST_SEASON,
    seasons,
  };
  process.stderr.write(`ok\n`);
}

const path = "sim/fixtures/rainfall.json";
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(out, null, 1) + "\n");

process.stderr.write(
  `\nwrote ${path}\n` +
    `  sites:   ${SITES.length}\n` +
    `  seasons: ${FIRST_SEASON}-${LAST_SEASON}\n` +
    `  daily values stored: ${totalDays}\n` +
    `  fill (-999) values:  ${totalFills}\n`
);
