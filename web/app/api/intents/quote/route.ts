/**
 * Proxies a 1Click quote.
 *
 * `dry` is forced to `true` unless live mode is explicitly enabled by env, and even then
 * the client has to ask for it. A dry quote is a real quote — real routing, real fees,
 * real signature — that commits nothing and moves nothing. NEAR Intents has no testnet,
 * so this is the only safe way for a reviewer to exercise the integration.
 */

import { LIVE_ENABLED, ONECLICK_BASE, oneClickHeaders, type QuoteResponse } from "@/lib/intents";

interface Body {
  originAsset?: string;
  destinationAsset?: string;
  amount?: string;
  refundTo?: string;
  recipient?: string;
  live?: boolean;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { originAsset, destinationAsset, amount, refundTo, recipient } = body;
  if (!originAsset || !destinationAsset || !amount || !refundTo || !recipient) {
    return Response.json(
      { error: "originAsset, destinationAsset, amount, refundTo and recipient are required" },
      { status: 400 },
    );
  }
  if (!/^\d+$/.test(amount)) {
    // 1Click amounts are integer strings in the token's base units.
    return Response.json({ error: "amount must be an integer string of base units" }, { status: 400 });
  }

  // The only place `dry` is decided. A client asking for live mode on a deployment that
  // has not enabled it gets a dry quote, not an error and not a live swap.
  const dry = !(LIVE_ENABLED && body.live === true);

  const payload = {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100, // 1%
    originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset,
    amount,
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  try {
    const res = await fetch(`${ONECLICK_BASE}/v0/quote`, {
      method: "POST",
      headers: oneClickHeaders(),
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: QuoteResponse;
    try {
      parsed = JSON.parse(text) as QuoteResponse;
    } catch {
      return Response.json(
        { error: `1Click returned ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }
    if (!res.ok) {
      return Response.json(
        { error: parsed.message ?? `1Click returned ${res.status}`, raw: parsed },
        { status: res.status },
      );
    }
    return Response.json({ dry, ...parsed });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "could not reach 1Click" },
      { status: 502 },
    );
  }
}
