#!/usr/bin/env tsx
/**
 * Recompute a policy's rainfall reading from the public NASA POWER API.
 *
 *   pnpm verify-oracle --policy 1
 *   pnpm verify-oracle --lat 6.45 --lon 7.51 --start 20250415 --days 30
 *
 * The point of this script is that nobody has to take our word for a settlement. It
 * fetches the same public dataset the oracle reads, applies the same integer algorithm
 * from docs/RULES.md §6, and prints the URL so the raw numbers can be checked by hand.
 *
 * With `--policy` it also reads the reading stored on chain and compares. A mismatch is
 * reported loudly and exits non-zero, which is what makes a dishonest keeper *detectable*
 * — see docs/THREAT_MODEL.md T16. It does not make one impossible; only the OutLayer path
 * does that, and even then you are trusting a TEE and NASA rather than nobody at all.
 */

import { windowTotal } from "../agents/pricing/index";

const NASA = "https://power.larc.nasa.gov/api/temporal/daily/point";
const RPC = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
const MARKET = process.env.MMIRI_MARKET ?? "";

interface Args {
  policy?: string;
  lat?: number;
  lon?: number;
  start?: number;
  days?: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k?.startsWith("--")) continue;
    const name = k.slice(2);
    if (name === "policy") {
      if (v !== undefined) a.policy = v;
    }
    else if (name === "lat") a.lat = Number(v);
    else if (name === "lon") a.lon = Number(v);
    else if (name === "start") a.start = Number(v);
    else if (name === "days") a.days = Number(v);
    i++;
  }
  return a;
}

function usage(): never {
  console.error(
    [
      "",
      "Recompute a Mmiri policy's rainfall reading from NASA POWER.",
      "",
      "  pnpm verify-oracle --policy <id>",
      "      Reads the policy's terms and stored reading from the contract and compares.",
      "      Needs MMIRI_MARKET set (and NEAR_RPC_URL if not testnet).",
      "",
      "  pnpm verify-oracle --lat <deg> --lon <deg> --start <YYYYMMDD> [--days 30]",
      "      Computes a window total directly, with nothing on chain involved.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

/** A NEAR view call over plain JSON-RPC. No SDK, no keys — this only reads. */
async function view<T>(method: string, args: Record<string, unknown>): Promise<T> {
  if (!MARKET) {
    throw new Error("MMIRI_MARKET is not set, so there is no contract to read from");
  }
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "verify",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: MARKET,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const body = (await res.json()) as {
    result?: { result?: number[] };
    error?: { message?: string; data?: unknown };
  };
  if (body.error) {
    throw new Error(`RPC error: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  const bytes = body.result?.result;
  if (!bytes) throw new Error(`no result from ${method}`);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
}

function nasaUrl(lat: number, lon: number, start: number, days: number): string {
  const d0 = new Date(
    Date.UTC(Math.floor(start / 10000), (Math.floor(start / 100) % 100) - 1, start % 100),
  );
  const d1 = new Date(d0.getTime() + (days - 1) * 86400_000);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
      d.getUTCDate(),
    ).padStart(2, "0")}`;
  const p = new URLSearchParams({
    parameters: "PRECTOTCORR",
    community: "AG",
    latitude: String(lat),
    longitude: String(lon),
    start: fmt(d0),
    end: fmt(d1),
    format: "JSON",
  });
  return `${NASA}?${p}`;
}

async function fetchDaily(url: string): Promise<Record<string, number>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NASA POWER returned ${res.status}`);
  const body = (await res.json()) as {
    properties?: { parameter?: { PRECTOTCORR?: Record<string, number> } };
    header?: { fill_value?: number };
  };
  const daily = body.properties?.parameter?.PRECTOTCORR;
  if (!daily) throw new Error("no PRECTOTCORR in the response");
  const fill = body.header?.fill_value;
  if (fill !== undefined && fill !== -999.0) {
    throw new Error(`unexpected fill_value ${fill}; refusing to compute`);
  }
  return daily;
}

interface Terms {
  lat_e4: number;
  lon_e4: number;
  start: number;
  days: number;
  strike_mm_x10: number;
  payout: string;
}

interface Policy {
  id: string;
  owner_id: string;
  underwriter: string;
  terms: Terms;
  status: string;
  reading: {
    mm_x10: number;
    days_valid: number;
    source: Record<string, { execution_ref?: string; account_id?: string }>;
  } | null;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));

  let lat: number;
  let lon: number;
  let start: number;
  let days: number;
  let policy: Policy | null = null;

  if (a.policy) {
    policy = await view<Policy | null>("get_policy", { policy_id: a.policy });
    if (!policy) {
      console.error(`No policy ${a.policy} on ${MARKET}.`);
      process.exit(1);
    }
    lat = policy.terms.lat_e4 / 10000;
    lon = policy.terms.lon_e4 / 10000;
    start = policy.terms.start;
    days = policy.terms.days;
  } else if (a.lat !== undefined && a.lon !== undefined && a.start !== undefined) {
    lat = a.lat;
    lon = a.lon;
    start = a.start;
    days = a.days ?? 30;
  } else {
    usage();
  }

  const url = nasaUrl(lat, lon, start, days);
  console.log("");
  console.log(`Place      ${lat}, ${lon}`);
  console.log(`Window     ${days} days from ${start}`);
  if (policy) {
    console.log(`Policy     #${policy.id}  (${policy.status})`);
    console.log(`Holder     ${policy.owner_id}`);
    console.log(`Strike     ${(policy.terms.strike_mm_x10 / 10).toFixed(1)} mm`);
  }
  console.log("");
  console.log("Source");
  console.log(`  ${url}`);
  console.log("");

  const daily = await fetchDaily(url);
  const d0 = new Date(
    Date.UTC(Math.floor(start / 10000), (Math.floor(start / 100) % 100) - 1, start % 100),
  );
  const ordered: number[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(d0.getTime() + i * 86400_000);
    const key = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
      d.getUTCDate(),
    ).padStart(2, "0")}`;
    ordered.push(daily[key] ?? -999.0);
  }

  // Exactly the algorithm in docs/RULES.md §6, from the shared library the oracle, the
  // simulation and the web app all use. Nothing is reimplemented here.
  const { mm_x10, days_valid } = windowTotal(ordered, days);

  console.log("Daily values (mm/day, as returned)");
  for (let i = 0; i < ordered.length; i += 10) {
    console.log(
      "  " +
        ordered
          .slice(i, i + 10)
          .map((v) => (v === -999.0 ? "  fill" : v.toFixed(2).padStart(6)))
          .join(" "),
    );
  }
  console.log("");
  console.log(`Recomputed total   ${(mm_x10 / 10).toFixed(1)} mm   (mm_x10 = ${mm_x10})`);
  console.log(`Days counted       ${days_valid} of ${days}`);

  if (days_valid !== days) {
    console.log("");
    console.log(
      "This window is incomplete, so the contract would reject it as a failed read\n" +
        "rather than treat the missing days as dry. NASA's near-real-time data lags about\n" +
        "three days; wait and try again.",
    );
  }

  if (!policy) {
    console.log("");
    process.exit(0);
  }

  if (!policy.reading) {
    console.log("");
    console.log("No reading stored on chain yet — this policy has not been settled.");
    process.exit(0);
  }

  const stored = policy.reading;
  const sourceKind = Object.keys(stored.source)[0] ?? "unknown";
  console.log("");
  console.log(`Stored on chain    ${(stored.mm_x10 / 10).toFixed(1)} mm   (mm_x10 = ${stored.mm_x10})`);
  console.log(`Days counted       ${stored.days_valid} of ${policy.terms.days}`);
  console.log(`Reported by        ${sourceKind}`);
  console.log("");

  if (stored.mm_x10 === mm_x10 && stored.days_valid === days_valid) {
    const paid = mm_x10 < policy.terms.strike_mm_x10;
    console.log("MATCH — the settlement is consistent with the public record.");
    console.log(
      `  ${(mm_x10 / 10).toFixed(1)} mm ${paid ? "<" : ">="} ${(policy.terms.strike_mm_x10 / 10).toFixed(1)} mm strike, ` +
        `so the policy ${paid ? "paid its holder" : "expired and the collateral was released"}.`,
    );
    process.exit(0);
  }

  console.log("MISMATCH — the stored reading differs from the public record.");
  console.log(
    `  on chain ${stored.mm_x10} vs recomputed ${mm_x10} (tenths of a mm),\n` +
      `  ${stored.days_valid} vs ${days_valid} valid days.`,
  );
  console.log("");
  console.log(
    "Two innocent explanations before assuming the worst: NASA revises historical\n" +
      "values, and a reading taken at settlement is final by design. But if this policy\n" +
      "was settled through the keeper rather than the TEE, a mismatch is exactly what a\n" +
      "dishonest keeper would produce. See docs/THREAT_MODEL.md T16.",
  );
  process.exit(1);
}

main().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
