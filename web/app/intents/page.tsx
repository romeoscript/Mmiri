import { IntentsPanel } from "@/components/intents-panel";
import { LIVE_ENABLED } from "@/lib/intents";

export const metadata = { title: "Pay from any chain — Mmiri" };

export default function IntentsPage() {
  return (
    <main>
      <h1>Pay from any chain, cash out to any chain</h1>
      <p className="lede">
        A farmer&rsquo;s premium does not have to start as USDC on NEAR, and a payout does
        not have to stay there. NEAR Intents routes either direction through its solver
        network, so the market contract only ever sees NEP-141 USDC and nobody has to acquire
        NEAR for gas to buy cover.
      </p>

      <div className="notice info">
        <strong>Why this is mainnet and dry.</strong> NEAR Intents has no testnet and none is
        planned — the organisers&rsquo; own guidance is mainnet with tiny amounts and{" "}
        <span className="mono">dry: true</span> quotes. So the market contract runs on
        testnet and this panel talks to the real mainnet 1Click API in dry mode. A dry quote
        is a real quote: real routing, real fees, a real ed25519 signature over the terms. It
        commits nothing and moves nothing.
      </div>

      <IntentsPanel
        liveEnabled={LIVE_ENABLED}
        // Deliberately NOT the market contract id. The market runs on testnet; Intents
        // settles NEAR *mainnet* USDC, so a `.testnet` recipient is rejected outright.
        // See the note below.
        defaultRecipient={process.env.NEXT_PUBLIC_INTENTS_RECIPIENT ?? "example.near"}
      />

      <div className="notice">
        <strong>The recipient has to be a mainnet account.</strong> The market contract
        lives on testnet, but NEAR Intents settles mainnet USDC — there is no testnet to
        settle on. Passing a <span className="mono">.testnet</span> recipient makes 1Click
        reject the quote with a bare <span className="mono">400 Internal server error</span>
        and no explanation, so it is worth saying plainly. In a production deployment the
        market and the Intents recipient would be the same mainnet account; here they
        cannot be.
      </div>

      <h2>How this fits the rest of Mmiri</h2>
      <ol className="small" style={{ color: "var(--text-secondary)", maxWidth: "72ch" }}>
        <li>
          A buyer holds USDC on Base, Arbitrum, Solana — wherever they already are. They ask
          1Click for a quote into USDC on NEAR with the market as recipient.
        </li>
        <li>
          They send the origin funds to the deposit address the live quote returns. The
          solvers route it and USDC lands on NEAR.
        </li>
        <li>
          That USDC opens a round through the contract&rsquo;s NEP-141{" "}
          <span className="mono">ft_on_transfer</span> hook, carrying the terms in the
          message — the same path an underwriter uses to deposit capital.
        </li>
        <li>
          When a policy pays, the holder receives NEP-141 USDC. The same panel in reverse
          quotes taking it out to whichever chain they want to spend it on.
        </li>
      </ol>

      <div className="notice">
        <strong>What is not built.</strong> The live path — submitting a deposit and polling{" "}
        <span className="mono">/v0/status</span> through to SUCCESS — is implemented behind{" "}
        <span className="mono">ONECLICK_LIVE</span>, which is{" "}
        {LIVE_ENABLED ? "enabled" : "off"} here, and has not been exercised with real funds.
        The status table above is the full set of states the code handles, not a record of
        states we have observed. We would rather say that than show a screenshot of a swap
        that never happened.
      </div>

      <div className="footnote">
        Asset ids are read live from <span className="mono">/v0/tokens</span> (230 tokens at
        last check) rather than hardcoded — a stale id is a swap into nothing. Amounts are
        integer strings in each token&rsquo;s base units. A JWT is not required for quotes; it
        only changes the fee tier, and this deployment{" "}
        {process.env.ONECLICK_JWT ? "has one configured" : "has none"}.
      </div>
    </main>
  );
}
