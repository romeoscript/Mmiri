/**
 * Proxies 1Click's token list.
 *
 * Server-side for two reasons: the browser cannot call the API directly (no CORS), and
 * asset ids must be read from `/v0/tokens` rather than hardcoded — they change, and a
 * stale id is a swap into nothing.
 */

import { ONECLICK_BASE, oneClickHeaders } from "@/lib/intents";

export const revalidate = 300;

export async function GET() {
  try {
    const res = await fetch(`${ONECLICK_BASE}/v0/tokens`, {
      headers: oneClickHeaders(),
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return Response.json(
        { error: `1Click returned ${res.status}`, tokens: [] },
        { status: 502 },
      );
    }
    const tokens = (await res.json()) as unknown[];
    return Response.json({ tokens });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "could not reach 1Click", tokens: [] },
      { status: 502 },
    );
  }
}
