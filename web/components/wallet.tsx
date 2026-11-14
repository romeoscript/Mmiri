"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { setupWalletSelector } from "@near-wallet-selector/core";
import type { WalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
// v10 types `actions` as near-api-js Actions, not the older {type, params} literal, so
// they have to be built with the action creators rather than written by hand.
import { actionCreators } from "@near-js/transactions";
import "@near-wallet-selector/modal-ui/styles.css";

const USDC_ID = process.env.NEXT_PUBLIC_USDC_ID ?? "";
const NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet") as
  | "testnet"
  | "mainnet";

export interface SendParams {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas?: string;
  deposit?: string;
}

interface WalletCtx {
  ready: boolean;
  accountId: string | null;
  signIn: () => void;
  signOut: () => Promise<void>;
  signAndSend: (p: SendParams) => Promise<string | null>;
  /** Transaction hashes a redirecting wallet handed back in the URL. */
  returnedTxHashes: string[];
  clearReturned: () => void;
}

const Ctx = createContext<WalletCtx | null>(null);

const DEFAULT_GAS = "100000000000000"; // 100 Tgas

/**
 * Wallet access for the buy flow.
 *
 * Browser-only and initialised after mount: wallet-selector touches `window` and
 * localStorage at construction, so it cannot be built during the server render.
 *
 * MyNearWallet is a redirecting web wallet — it navigates away to approve and comes back
 * with `transactionHashes` on the URL rather than resolving the promise. Meteor is an
 * extension and resolves in place. Both are supported, so the flow has to treat "no
 * outcome returned" as success-pending rather than as failure, and pick the result up
 * from the query string on the way back in.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [returnedTxHashes, setReturnedTxHashes] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const s = await setupWalletSelector({
        network: NETWORK,
        modules: [setupMyNearWallet(), setupMeteorWallet()],
      });
      if (cancelled) return;

      const m = setupModal(s, { contractId: USDC_ID });
      setSelector(s);
      setModal(m);

      const state = s.store.getState();
      setAccountId(state.accounts.find((a) => a.active)?.accountId ?? null);

      const sub = s.store.observable.subscribe((st) => {
        setAccountId(st.accounts.find((a) => a.active)?.accountId ?? null);
      });
      return () => sub.unsubscribe();
    })().catch((e) => {
      console.error("[mmiri] wallet selector failed to start", e);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // A redirecting wallet returns here with its result on the URL. Pick it up, then strip
  // it, so a refresh does not re-announce a transaction that already happened.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashes = params.get("transactionHashes");
    if (!hashes) return;
    setReturnedTxHashes(hashes.split(","));
    params.delete("transactionHashes");
    params.delete("errorCode");
    params.delete("errorMessage");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : ""),
    );
  }, []);

  const signIn = useCallback(() => modal?.show(), [modal]);

  const signOut = useCallback(async () => {
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
    setAccountId(null);
  }, [selector]);

  const signAndSend = useCallback(
    async ({ receiverId, methodName, args, gas, deposit }: SendParams) => {
      if (!selector) throw new Error("Wallet is still starting up.");
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId,
        actions: [
          actionCreators.functionCall(
            methodName,
            args,
            BigInt(gas ?? DEFAULT_GAS),
            BigInt(deposit ?? "0"),
          ),
        ],
      });
      // Redirecting wallets navigate away instead of resolving with an outcome.
      return outcome?.transaction_outcome?.id ?? null;
    },
    [selector],
  );

  const value = useMemo<WalletCtx>(
    () => ({
      ready: Boolean(selector),
      accountId,
      signIn,
      signOut,
      signAndSend,
      returnedTxHashes,
      clearReturned: () => setReturnedTxHashes([]),
    }),
    [selector, accountId, signIn, signOut, signAndSend, returnedTxHashes],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
