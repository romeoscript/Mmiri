/**
 * NEAR Intents / 1Click.
 *
 * Two facts drive the shape of this module, both verified against the live API rather
 * than taken from the docs:
 *
 *  - A `dry: true` quote needs **no credentials at all**. A quote with neither an
 *    `Authorization` header nor an `X-API-Key` returned HTTP 201. A JWT only changes the
 *    fee tier, so the panel works for a reviewer with nothing configured.
 *  - The fee does not appear as a single line item. A 20 USDC base→near dry quote came
 *    back with `amountOut` 19.991932 — a 0.040% round trip — itemised as `refundFee` and
 *    `withdrawFee`, plus an `appFees` entry we did not set. So this code never asserts a
 *    fee rate; it shows the numbers the API returns and lets them speak.
 *
 * Live mode is gated on an env flag that is off by default. NEAR Intents has no testnet,
 * so "live" means real mainnet value — never something to leave switched on.
 */

export const ONECLICK_BASE =
  process.env.ONECLICK_BASE_URL ?? "https://1click.chaindefuser.com";

/** Off unless explicitly enabled. Live mode moves real money on mainnet. */
export const LIVE_ENABLED = process.env.ONECLICK_LIVE === "true";

export function oneClickHeaders(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const jwt = process.env.ONECLICK_JWT;
  // Optional: a JWT only lowers the fee tier. Quotes work without one.
  if (jwt) h.Authorization = `Bearer ${jwt}`;
  return h;
}

export interface TokenInfo {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  contractAddress?: string;
}

export interface QuoteResponse {
  quote?: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd?: string;
    minAmountIn?: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd?: string;
    minAmountOut: string;
    timeEstimate?: number;
    refundFee?: string;
    withdrawFee?: string;
    depositAddress?: string;
    deadline?: string;
  };
  quoteRequest?: Record<string, unknown>;
  signature?: string;
  timestamp?: string;
  correlationId?: string;
  message?: string;
}

/**
 * Every status 1Click can report, with what it means for the person's money.
 *
 * The DeFi and Real-World Money tracks both ask for REFUNDED and FAILED to be handled
 * rather than swallowed, so all seven are enumerated here with the one thing a user
 * actually wants to know: where are my funds right now.
 */
export const STATUSES = [
  {
    id: "PENDING_DEPOSIT",
    label: "Waiting for your deposit",
    funds: "Still in your wallet on the origin chain. Nothing has moved.",
    kind: "waiting",
  },
  {
    id: "KNOWN_DEPOSIT_TX",
    label: "Deposit seen",
    funds: "Your deposit transaction is visible on the origin chain, not yet confirmed.",
    kind: "waiting",
  },
  {
    id: "PROCESSING",
    label: "Swapping",
    funds: "Held by the Intents solvers mid-route. Neither chain shows it as yours yet.",
    kind: "waiting",
  },
  {
    id: "SUCCESS",
    label: "Done",
    funds: "USDC has arrived at the recipient on NEAR. The premium can be paid.",
    kind: "good",
  },
  {
    id: "INCOMPLETE_DEPOSIT",
    label: "Deposit too small",
    funds:
      "Less arrived than the quote required. It sits at the deposit address until you top it up or it is refunded.",
    kind: "warning",
  },
  {
    id: "REFUNDED",
    label: "Refunded",
    funds:
      "Sent back to your refund address on the origin chain, minus the refund fee the quote showed.",
    kind: "serious",
  },
  {
    id: "FAILED",
    label: "Failed",
    funds:
      "The route could not complete. Funds are refunded to the refund address; nothing is left with us.",
    kind: "critical",
  },
] as const;

export type StatusId = (typeof STATUSES)[number]["id"];

export function statusInfo(id: string) {
  return STATUSES.find((s) => s.id === id) ?? null;
}
