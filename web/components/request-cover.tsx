"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/components/wallet";
import { RainField } from "@/components/rain-field";

const USDC_ID = process.env.NEXT_PUBLIC_USDC_ID ?? "";
const MARKET_ID = process.env.NEXT_PUBLIC_MARKET_ID ?? "";
const RPC = process.env.NEXT_PUBLIC_NEAR_RPC ?? "https://rpc.testnet.near.org";
const EXPLORER = "https://testnet.nearblocks.io";

const USDC_UNITS = 1_000_000n;
const FAUCET_AMOUNT = 500n * USDC_UNITS;

/** A browser-safe view call. `lib/near.ts` uses Buffer, which is a server global. */
async function view<T>(
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T | null> {
  if (!contractId) return null;
  try {
    const res = await fetch(RPC, {
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
          args_base64: btoa(JSON.stringify(args)),
        },
      }),
    });
    const body = (await res.json()) as { result?: { result?: number[] } };
    const bytes = body.result?.result;
    if (!bytes) return null;
    return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T;
  } catch {
    return null;
  }
}

const fmt = (raw: bigint) =>
  (Number(raw) / Number(USDC_UNITS)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export interface CoverTerms {
  lat_e4: number;
  lon_e4: number;
  start: number;
  days: number;
  strike_mm_x10: number;
  payout: string;
}

type Phase = "idle" | "working" | "sent" | "error";

/**
 * The buy flow: connect, fund, and open a round.
 *
 * Opening a round is a NEP-141 `ft_transfer_call` carrying the buyer's maximum premium
 * into the market, with the terms in `msg`. It needs exactly 1 yoctoNEAR, which is what
 * makes it a deliberate, separately-approved action in every wallet rather than
 * something a scoped key can do quietly.
 *
 * The mock USDC contract's `mint` is deliberately open on testnet, so a visitor who has
 * never held the token can fund themselves here instead of being stuck at a zero balance
 * with nothing to click.
 */
export function RequestCover({
  terms,
  maxPremium,
  siteName,
  windowLabel,
  expectedPremium,
}: {
  terms: CoverTerms;
  maxPremium: string;
  siteName: string;
  windowLabel: string;
  expectedPremium: string | null;
}) {
  const { ready, accountId, signIn, signAndSend, returnedTxHashes, clearReturned } =
    useWallet();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accountId) {
      setBalance(null);
      return;
    }
    const raw = await view<string>(USDC_ID, "ft_balance_of", {
      account_id: accountId,
    });
    setBalance(raw === null ? null : BigInt(raw));
  }, [accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A redirecting wallet lands back here with its hashes on the URL.
  useEffect(() => {
    if (returnedTxHashes.length === 0) return;
    setTxHash(returnedTxHashes[0] ?? null);
    setPhase("sent");
    setMessage(null);
    clearReturned();
    void refresh();
  }, [returnedTxHashes, clearReturned, refresh]);

  const run = useCallback(
    async (fn: () => Promise<string | null>, working: string) => {
      setPhase("working");
      setMessage(working);
      try {
        const hash = await fn();
        // Null means the wallet navigated away to approve; it will come back.
        if (hash) {
          setTxHash(hash);
          setPhase("sent");
          setMessage(null);
          await refresh();
        }
      } catch (e) {
        setPhase("error");
        setMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh],
  );

  const fund = () =>
    run(
      () =>
        signAndSend({
          receiverId: USDC_ID,
          methodName: "mint",
          args: { account_id: accountId, amount: FAUCET_AMOUNT.toString() },
          gas: "30000000000000",
        }),
      "Minting test USDC…",
    );

  const buy = () =>
    run(
      () =>
        signAndSend({
          receiverId: USDC_ID,
          methodName: "ft_transfer_call",
          args: {
            receiver_id: MARKET_ID,
            amount: maxPremium,
            msg: JSON.stringify({ RequestCover: { terms } }),
          },
          deposit: "1",
        }),
      "Opening the round…",
    );

  const max = BigInt(maxPremium);
  const funded = balance !== null && balance >= max;
  const busy = phase === "working";

  if (!MARKET_ID || !USDC_ID) {
    return (
      <div className="notice">
        <strong>No contract is configured for this build</strong>, so there is nothing to
        sign. Set <span className="mono">NEXT_PUBLIC_MARKET_ID</span> and{" "}
        <span className="mono">NEXT_PUBLIC_USDC_ID</span>.
      </div>
    );
  }

  return (
    <div className="buy">
      <RainField />
      <div className="buy-summary">
        <div>
          <h3>Request this cover</h3>
          <p className="small muted">
            {siteName} — {windowLabel} — pays {fmt(BigInt(terms.payout))} USDC if the window
            totals less than {(terms.strike_mm_x10 / 10).toFixed(1)} mm.
          </p>
        </div>
        <div className="buy-price">
          <span className="buy-price-value">{fmt(max)}</span>
          <span className="buy-price-label">USDC maximum</span>
        </div>
      </div>

      {expectedPremium ? (
        <p className="small muted buy-expect">
          The market is quoting <strong>{expectedPremium} USDC</strong> at these terms. You
          pay the winning bid, not your maximum, and the difference is refunded when the
          round clears.
        </p>
      ) : null}

      <div className="buy-actions">
        {!ready ? (
          <button className="btn btn-primary" disabled>
            Starting wallet…
          </button>
        ) : !accountId ? (
          <button className="btn btn-primary" onClick={signIn}>
            Connect wallet to continue
          </button>
        ) : !funded ? (
          <button className="btn btn-primary" onClick={fund} disabled={busy}>
            {busy ? "Working…" : `Get ${fmt(FAUCET_AMOUNT)} test USDC`}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={buy} disabled={busy}>
            {busy ? "Working…" : `Request cover — up to ${fmt(max)} USDC`}
          </button>
        )}

        {accountId ? (
          <span className="buy-balance">
            {balance === null
              ? "Checking balance…"
              : `Balance ${fmt(balance)} USDC`}
          </span>
        ) : null}
      </div>

      {phase === "error" && message ? (
        <div className="notice" role="alert">
          <strong>That did not go through.</strong> {message} Nothing was charged — you can
          try again.
        </div>
      ) : null}

      {phase === "working" && message ? (
        <p className="small muted" role="status">
          {message} Approve it in your wallet.
        </p>
      ) : null}

      {phase === "sent" ? (
        <div className="notice info" role="status">
          <strong>Done.</strong> {funded ? "Your round is open — " : "Balance funded — "}
          {txHash ? (
            <a href={`${EXPLORER}/txns/${txHash}`}>see the transaction</a>
          ) : (
            "check your wallet"
          )}
          . Live rounds appear on <a href="/rounds">rounds</a>, and the policy will show on{" "}
          <a href="/policies">policies</a> once the auction clears.
        </div>
      ) : null}

      <p className="small muted buy-foot">
        Testnet only. You need a little testnet NEAR for gas — the{" "}
        <a href="https://near-faucet.io">NEAR faucet</a> will give you some. Opening a round
        attaches 1 yoctoNEAR, which is what makes your wallet ask every time.
      </p>
    </div>
  );
}
