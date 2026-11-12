"use client";

/**
 * The 1Click panel: a real quote for paying a premium from another chain, and for taking
 * a payout out to one.
 *
 * Everything here hits the live API through our own route handlers. Nothing is mocked —
 * if the quote shows 19.991932 USDC out for 20.000000 in, that is what the solvers
 * actually offered at that moment.
 */

import { useCallback, useEffect, useState } from "react";
import { STATUSES, type QuoteResponse, type TokenInfo } from "@/lib/intents";

type Direction = "pay-in" | "cash-out";

const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** Chains worth offering first — the ones a farmer's buyer or a lender is likely to hold. */
const PREFERRED = ["base", "arb", "eth", "sol", "pol", "bsc", "avax", "op"];

export function IntentsPanel({
  liveEnabled,
  defaultRecipient,
}: {
  liveEnabled: boolean;
  defaultRecipient: string;
}) {
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>("pay-in");
  const [chain, setChain] = useState("base");
  const [amount, setAmount] = useState("20");
  const [refundTo, setRefundTo] = useState("0x2527D02599Ba641c19FEa793cD0F167589a0f10D");
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [quote, setQuote] = useState<(QuoteResponse & { dry?: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/intents/tokens")
      .then((r) => r.json())
      .then((d: { tokens?: TokenInfo[]; error?: string }) => {
        if (cancelled) return;
        if (d.error) setTokensError(d.error);
        setTokens(d.tokens ?? []);
      })
      .catch((e: Error) => !cancelled && setTokensError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const usdcByChain = (tokens ?? []).filter(
    (t) => t.symbol.toUpperCase() === "USDC" && t.blockchain !== "near",
  );
  const chains = [
    ...new Set([
      ...PREFERRED.filter((c) => usdcByChain.some((t) => t.blockchain === c)),
      ...usdcByChain.map((t) => t.blockchain),
    ]),
  ];
  const origin = usdcByChain.find((t) => t.blockchain === chain);
  const nearUsdc = (tokens ?? []).find((t) => t.assetId === NEAR_USDC);

  const getQuote = useCallback(async () => {
    setError(null);
    setQuote(null);
    if (!origin || !nearUsdc) {
      setError("Token list has not loaded yet.");
      return;
    }
    const from = direction === "pay-in" ? origin : nearUsdc;
    const to = direction === "pay-in" ? nearUsdc : origin;
    const base = BigInt(Math.round(Number(amount) * 10 ** from.decimals));
    if (base <= 0n) {
      setError("Enter an amount above zero.");
      return;
    }
    const nearSide = direction === "pay-in" ? recipient : refundTo;
    if (!/\.near$|^[0-9a-f]{64}$/.test(nearSide.trim())) {
      setError(
        "The NEAR side must be a mainnet account — a name ending in .near, or a 64-character " +
          "implicit address. Intents settles mainnet USDC, so a .testnet account is rejected.",
      );
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/intents/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originAsset: from.assetId,
          destinationAsset: to.assetId,
          amount: base.toString(),
          // On a cash-out the refund has to land somewhere on NEAR, not on the EVM chain.
          refundTo: direction === "pay-in" ? refundTo : recipient,
          recipient: direction === "pay-in" ? recipient : refundTo,
        }),
      });
      const d = (await res.json()) as QuoteResponse & { dry?: boolean; error?: string };
      if (d.error) {
        // 1Click answers some rejected quotes with a bare "Internal server error" and a
        // correlation id. Pass the upstream text through, but add the cause when we can
        // reasonably infer it rather than leaving the user staring at nothing.
        setError(
          d.error === "Internal server error"
            ? `1Click rejected the quote ("${d.error}"). The usual cause is an address the ` +
              `destination chain will not accept — check the NEAR account is mainnet and the ` +
              `origin address matches ${chain}.`
            : d.error,
        );
      } else setQuote(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setLoading(false);
    }
  }, [origin, nearUsdc, direction, amount, refundTo, recipient, chain]);

  const q = quote?.quote;
  const inUnits = origin ? 10 ** origin.decimals : 1e6;
  const fee =
    q && direction === "pay-in"
      ? (Number(q.amountIn) - Number(q.amountOut)) / Number(q.amountIn)
      : q
        ? (Number(q.amountIn) - Number(q.amountOut)) / Number(q.amountIn)
        : null;

  return (
    <div>
      <div className="card">
        <div className="grid cols-4">
          <div>
            <label className="field" htmlFor="dir">
              Direction
            </label>
            <select
              id="dir"
              value={direction}
              onChange={(e) => setDirection(e.target.value as Direction)}
            >
              <option value="pay-in">Pay a premium from another chain</option>
              <option value="cash-out">Take a payout to another chain</option>
            </select>
          </div>
          <div>
            <label className="field" htmlFor="chain">
              {direction === "pay-in" ? "Paying from" : "Cashing out to"}
            </label>
            <select id="chain" value={chain} onChange={(e) => setChain(e.target.value)}>
              {chains.length === 0 ? <option>loading…</option> : null}
              {chains.map((c) => (
                <option key={c} value={c}>
                  USDC on {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field" htmlFor="amt">
              Amount (USDC)
            </label>
            <input
              id="amt"
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button onClick={getQuote} disabled={loading || !origin || !nearUsdc}>
              {loading ? "Asking the solvers…" : "Get a real quote"}
            </button>
          </div>
        </div>

        <div className="grid cols-2" style={{ marginTop: 12 }}>
          <div>
            <label className="field" htmlFor="refund">
              {direction === "pay-in" ? "Refund address on the origin chain" : "Destination address"}
            </label>
            <input
              id="refund"
              type="text"
              value={refundTo}
              onChange={(e) => setRefundTo(e.target.value)}
            />
          </div>
          <div>
            <label className="field" htmlFor="recip">
              {direction === "pay-in" ? "NEAR recipient" : "NEAR refund account"}
            </label>
            <input
              id="recip"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>
        </div>

        <p className="small muted" style={{ marginBottom: 0, marginTop: 10 }}>
          {liveEnabled ? (
            <>
              Live mode is <strong>enabled</strong> on this deployment, but this panel still
              only ever requests <span className="mono">dry: true</span> quotes.
            </>
          ) : (
            <>
              Quotes are <span className="mono">dry: true</span> — real routing, real fees, a
              real signed quote, and nothing moves. NEAR Intents has no testnet, so this is
              the only way to exercise the integration without spending mainnet funds.
            </>
          )}
        </p>
      </div>

      {tokensError ? (
        <div className="notice">
          Could not load the 1Click token list: {tokensError}. Asset ids are read from{" "}
          <span className="mono">/v0/tokens</span> rather than hardcoded, so the panel will
          not guess them.
        </div>
      ) : null}

      {error ? <div className="notice">{error}</div> : null}

      {q ? (
        <>
          <h3>The quote</h3>
          <div className="grid cols-4">
            <div className="tile">
              <div className="label">You send</div>
              <div className="value">{q.amountInFormatted}</div>
              <div className="note">
                USDC on {direction === "pay-in" ? chain : "near"}
                {q.amountInUsd ? ` · $${Number(q.amountInUsd).toFixed(2)}` : ""}
              </div>
            </div>
            <div className="tile">
              <div className="label">They receive</div>
              <div className="value">{q.amountOutFormatted}</div>
              <div className="note">
                USDC on {direction === "pay-in" ? "near" : chain}
                {q.amountOutUsd ? ` · $${Number(q.amountOutUsd).toFixed(2)}` : ""}
              </div>
            </div>
            <div className="tile">
              <div className="label">Round trip cost</div>
              <div className="value">{fee === null ? "—" : `${(fee * 100).toFixed(3)}%`}</div>
              <div className="note">
                what the numbers show, not a published rate
              </div>
            </div>
            <div className="tile">
              <div className="label">Estimated time</div>
              <div className="value">{q.timeEstimate ? `${q.timeEstimate}s` : "—"}</div>
              <div className="note">
                guaranteed at least {(Number(q.minAmountOut) / inUnits).toFixed(6)} out
              </div>
            </div>
          </div>

          <div className="card">
            <table>
              <tbody>
                <tr>
                  <th>Refund fee</th>
                  <td className="mono">{q.refundFee ?? "—"}</td>
                  <td className="small muted">
                    charged if the swap is refunded rather than completed
                  </td>
                </tr>
                <tr>
                  <th>Withdraw fee</th>
                  <td className="mono">{q.withdrawFee ?? "—"}</td>
                  <td className="small muted">charged on delivery to the destination chain</td>
                </tr>
                <tr>
                  <th>Quote signature</th>
                  <td className="mono small" style={{ wordBreak: "break-all" }}>
                    {quote?.signature ? `${quote.signature.slice(0, 44)}…` : "—"}
                  </td>
                  <td className="small muted">
                    ed25519 over the quote, so the terms cannot be altered afterwards
                  </td>
                </tr>
                <tr>
                  <th>Correlation id</th>
                  <td className="mono small">{quote?.correlationId ?? "—"}</td>
                  <td className="small muted">what you quote at support if a swap goes wrong</td>
                </tr>
                <tr>
                  <th>Deposit address</th>
                  <td className="mono small" style={{ wordBreak: "break-all" }}>
                    {q.depositAddress ?? <span className="muted">none — this is a dry quote</span>}
                  </td>
                  <td className="small muted">
                    a live quote returns an address to send the origin funds to
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="small muted">
            Note what is <em>not</em> claimed here. The 0.2% fee quoted in the hackathon FAQ
            and the 0.25% in the Intents docs do not appear as a line item in the response.
            This panel reports the API&rsquo;s own numbers — <span className="mono">amountIn</span>,{" "}
            <span className="mono">amountOut</span>, <span className="mono">refundFee</span>,{" "}
            <span className="mono">withdrawFee</span> — and asserts no fee rate of its own.
          </p>
        </>
      ) : null}

      <h3>Where the money sits, at every step</h3>
      <p className="small muted">
        All seven statuses 1Click can report. A dry quote never enters this lifecycle; a
        live one does, and the two that matter most are the two that are easy to swallow:
        REFUNDED and FAILED.
      </p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Means</th>
              <th>Where your funds are</th>
            </tr>
          </thead>
          <tbody>
            {STATUSES.map((s) => (
              <tr key={s.id}>
                <td>
                  <span className="chip">
                    <span
                      className="dot"
                      style={{
                        background:
                          s.kind === "good"
                            ? "var(--status-good)"
                            : s.kind === "warning"
                              ? "var(--status-warning)"
                              : s.kind === "serious"
                                ? "var(--status-serious)"
                                : s.kind === "critical"
                                  ? "var(--status-critical)"
                                  : "var(--text-muted)",
                      }}
                    />
                    <span className="mono" style={{ fontSize: 11 }}>
                      {s.id}
                    </span>
                  </span>
                </td>
                <td>{s.label}</td>
                <td className="small muted">{s.funds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
