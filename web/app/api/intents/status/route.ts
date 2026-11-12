/**
 * Proxies 1Click's swap status.
 *
 * Only meaningful once a real deposit exists, so it is reachable but will report nothing
 * for a dry quote — which is the honest answer rather than a fabricated "PROCESSING".
 */

import { ONECLICK_BASE, oneClickHeaders } from "@/lib/intents";

export async function GET(req: Request) {
  const depositAddress = new URL(req.url).searchParams.get("depositAddress");
  if (!depositAddress) {
    return Response.json({ error: "depositAddress is required" }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${ONECLICK_BASE}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
      { headers: oneClickHeaders(), cache: "no-store" },
    );
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return Response.json(parsed, { status: res.ok ? 200 : res.status });
    } catch {
      return Response.json(
        { error: `1Click returned ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "could not reach 1Click" },
      { status: 502 },
    );
  }
}
