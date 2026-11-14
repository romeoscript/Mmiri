#!/usr/bin/env tsx
/**
 * Post a rainfall reading to the market as the keeper.
 *
 *   pnpm keeper --policy 4 --mm-x10 536 --days 30
 *
 * This exists because the keeper cannot be driven from the NEAR CLI. `scripts/setup-agents`
 * deletes the keeper's full-access key on purpose -- that deletion is what makes the
 * security claim in THREAT_MODEL.md true -- and `near ... sign-with-keychain` only resolves
 * full-access keys, so it reports "no access keys found in keychain" for an account that is
 * working exactly as designed. The keeper's scoped function-call key lives in `KEEPER_KEY`,
 * and near-api-js signs with it directly, the same way the underwriter agents do.
 *
 * The key is scoped to `submit_observation` on the market contract and nothing else, so
 * this script cannot move money, add keys, or call anything but settlement.
 *
 * In keeper mode the keeper is trusted to report the reading honestly; `scripts/verify-oracle`
 * is what makes a false reading detectable after the fact. See the README's oracle trust model.
 */

import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";

const GAS = 100_000_000_000_000n; // 100 Tgas

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`--${name} is required.\n\n  pnpm keeper --policy 4 --mm-x10 536 --days 30\n`);
    process.exit(1);
  }
  return value;
}

const policyId = required("policy", flag("policy"));
const mmX10 = Number(required("mm-x10", flag("mm-x10")));
const daysValid = Number(flag("days") ?? "30");

const market = process.env.MMIRI_MARKET
  ?? (process.env.MMIRI_PARENT ? `market.${process.env.MMIRI_PARENT}` : "");
const keeper = process.env.MMIRI_KEEPER
  ?? (process.env.MMIRI_PARENT ? `keeper.${process.env.MMIRI_PARENT}` : "");
const secret = process.env.KEEPER_KEY;

if (!market || !keeper) {
  console.error("MMIRI_MARKET / MMIRI_KEEPER (or MMIRI_PARENT) is not set. See .env.example.");
  process.exit(1);
}
if (!secret) {
  console.error(
    "KEEPER_KEY is not set. Run scripts/setup-agents, then put the keeper's function-call key in .env.",
  );
  process.exit(1);
}
if (!Number.isInteger(mmX10) || mmX10 < 0) {
  console.error("--mm-x10 must be a non-negative integer (tenths of a millimetre).");
  process.exit(1);
}

const provider = new JsonRpcProvider({
  url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org",
});
const account = new Account(keeper, provider, KeyPairSigner.fromSecretKey(secret as never));

await account.callFunction({
  contractId: market,
  methodName: "submit_observation",
  args: { policy_id: policyId, mm_x10: mmX10, days_valid: daysValid },
  gas: GAS,
});

console.log(
  `keeper posted ${(mmX10 / 10).toFixed(1)} mm (mm_x10 = ${mmX10}, ${daysValid} days) for policy ${policyId}`,
);
