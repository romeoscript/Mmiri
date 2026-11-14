"use client";

import { useWallet } from "@/components/wallet";

/** Shortens a long account id without hiding which account it is. */
function short(id: string) {
  if (id.length <= 22) return id;
  const [name, ...rest] = id.split(".");
  const tld = rest.length ? `.${rest.join(".")}` : "";
  return `${(name ?? "").slice(0, 6)}…${(name ?? "").slice(-4)}${tld}`;
}

export function ConnectButton() {
  const { ready, accountId, signIn, signOut } = useWallet();

  if (!ready) {
    // Holds the same box the real control will occupy, so the masthead does not jump.
    return (
      <span className="cta-sm is-idle" aria-hidden="true">
        Wallet
      </span>
    );
  }

  if (!accountId) {
    return (
      <button type="button" className="cta-sm is-action" onClick={signIn}>
        Connect wallet
      </button>
    );
  }

  return (
    <span className="wallet-chip">
      <span className="wallet-id" title={accountId}>
        {short(accountId)}
      </span>
      <button type="button" className="wallet-out" onClick={signOut}>
        Disconnect
      </button>
    </span>
  );
}
