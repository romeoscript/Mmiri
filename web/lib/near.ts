/**
 * Read-only NEAR RPC.
 *
 * Deliberately just `fetch` against the JSON-RPC `call_function` query — no wallet SDK,
 * no signing, nothing that needs a key. Every page that uses this works with no wallet
 * connected, which is what the brief asks of the read-only views.
 *
 * When no contract is configured (`NEXT_PUBLIC_MARKET_ID` unset) every call returns
 * `null` and the pages say so plainly rather than pretending to have data. That is the
 * state a reviewer will most likely find the app in before testnet deployment, and it
 * should look deliberate rather than broken.
 */

export const MARKET_ID = process.env.NEXT_PUBLIC_MARKET_ID ?? "";
export const USDC_ID = process.env.NEXT_PUBLIC_USDC_ID ?? "";
export const RPC_URL = process.env.NEXT_PUBLIC_NEAR_RPC ?? "https://rpc.testnet.near.org";
export const NETWORK = process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet";

export function contractConfigured(): boolean {
  return MARKET_ID.length > 0;
}

export function explorerAccount(accountId: string): string {
  const base = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
  return `${base}/address/${accountId}`;
}

export function explorerTx(hash: string): string {
  const base = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
  return `${base}/txns/${hash}`;
}

/**
 * Calls a view method. Returns `null` on any failure rather than throwing, so one
 * unreachable RPC cannot take down a page that has other things to show.
 */
export async function view<T>(
  method: string,
  args: Record<string, unknown> = {},
  contractId: string = MARKET_ID,
): Promise<T | null> {
  if (!contractId) return null;
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mmiri",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: contractId,
          method_name: method,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      result?: { result?: number[] };
      error?: unknown;
    };
    const bytes = body.result?.result;
    if (!bytes) return null;
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Contract shapes, mirroring contracts/market/src/types.rs
// ---------------------------------------------------------------------------

export interface Terms {
  lat_e4: number;
  lon_e4: number;
  start: number;
  days: number;
  strike_mm_x10: number;
  payout: string;
}

export interface Commit {
  bidder: string;
  hash: number[];
  bond: string;
  seq: number;
  revealed_premium: string | null;
}

export interface Round {
  id: string;
  buyer: string;
  terms: Terms;
  max_premium: string;
  commit_deadline: string;
  reveal_deadline: string;
  phase: "Commit" | "Reveal" | "Settled" | "Refunded";
  commits: Commit[];
  winner: string | null;
  clearing_premium: string | null;
}

export interface Reading {
  mm_x10: number;
  days_valid: number;
  source: { OutLayer: { execution_ref: string } } | { Keeper: { account_id: string } };
  observed_at: string;
}

export interface Policy {
  id: string;
  owner_id: string;
  underwriter: string;
  terms: Terms;
  premium: string;
  status: "Active" | "PaidOut" | "Expired";
  reading: Reading | null;
  settling: boolean;
}

export interface Underwriter {
  free: string;
  locked: string;
}

export interface Solvency {
  total_free: string;
  total_locked: string;
  total_escrow: string;
  total_bonds: string;
  total_claimable: string;
  obligations: string;
  tracked_balance: string;
  balanced: boolean;
}

export interface Config {
  owner_id: string;
  usdc_account: string;
  outlayer_account: string;
  keeper_account: string;
  oracle_wasm_url: string;
  oracle_wasm_sha256: string;
  commit_seconds: number;
  reveal_seconds: number;
  settle_delay_days: number;
  bid_bond: string;
  demo_mode: boolean;
}

export const getConfig = () => view<Config>("get_config");
export const getSolvency = () => view<Solvency>("solvency");
export const getRounds = (limit = 50) => view<Round[]>("get_rounds", { limit });
export const getRound = (id: string) => view<Round | null>("get_round", { round_id: id });
export const getPolicies = (limit = 50) => view<Policy[]>("get_policies", { limit });
export const getPolicy = (id: string) => view<Policy | null>("get_policy", { policy_id: id });
export const getUnderwriters = (limit = 20) =>
  view<[string, Underwriter][]>("get_underwriters", { limit });

/** Phase as the chain sees it, which is the deadlines rather than the stored label. */
export function effectivePhase(r: Round, nowSecs: number): string {
  if (r.phase === "Settled") return "cleared";
  if (r.phase === "Refunded") return "refunded — no bid";
  if (nowSecs < Number(r.commit_deadline)) return "taking sealed bids";
  if (nowSecs < Number(r.reveal_deadline)) return "revealing";
  return "ready to finalize";
}
