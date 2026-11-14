import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { Nav } from "@/components/nav";
import { Logo, Mark } from "@/components/logo";
import { WalletProvider } from "@/components/wallet";
import { ConnectButton } from "@/components/connect-button";
import "./globals.css";

// Archivo is variable on both weight and width. next/font ships weight only unless the
// extra axis is asked for by name, and the whole type system here leans on width, so
// without `wdth` every `font-stretch` in the stylesheet would quietly do nothing.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: "Mmiri — rainfall cover on NEAR",
  description:
    "A sealed-bid market where underwriter agents compete to price rainfall risk for smallholder farmers. Settled from NASA rainfall data; the policy is an NFT that carries the payout.",
};

// Runs before first paint. Elements the load sequence animates are hidden by
// `html[data-motion] [data-animate]`, so that flag must only exist where the script will
// actually run them: no JavaScript, or reduced motion, and the page renders as written
// instead of staying invisible.
//
// It is an attribute rather than a class because React renders `className` on <html> and
// reconciles it on hydration: adding a class here before hydration is a mismatch React
// reports and refuses to patch. It does not track attributes it never rendered.
const MOTION_FLAG = `try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.setAttribute('data-motion','')}}catch(e){}`;

const MARKET = "market.mmiri-demo.testnet";
const REPO = "https://github.com/romeoscript/Mmiri";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_FLAG }} />
      </head>
      <body>
        <WalletProvider>
          <header className="top">
            <div className="inner">
              <a href="/" className="brand" aria-label="Mmiri, home">
                <Logo />
              </a>
              <Nav />
              <ConnectButton />
            </div>
          </header>

          <div className="shell">{children}</div>
        </WalletProvider>

        <footer className="site-foot">
          <div className="inner">
            <div className="foot-brand">
              <Mark size={32} />
              <p className="small muted">
                Index insurance for smallholder farmers, priced by a sealed-bid market and
                settled from the public rainfall record. Built on NEAR.
              </p>
            </div>

            <div className="foot-col">
              <h3>The market</h3>
              <a href="/">Request cover</a>
              <a href="/rounds">Rounds &amp; underwriters</a>
              <a href="/policies">Policies</a>
              <a href="/simulation">Simulation</a>
              <a href="/intents">Pay from any chain</a>
            </div>

            <div className="foot-col">
              <h3>On chain</h3>
              <a href={`https://testnet.nearblocks.io/address/${MARKET}`}>Market contract</a>
              <a href="https://testnet.nearblocks.io/address/usdc.mmiri-demo.testnet">
                USDC contract
              </a>
              <a href="https://testnet.nearblocks.io/address/keeper.mmiri-demo.testnet">
                Keeper
              </a>
              <a href={REPO}>Source</a>
            </div>
          </div>

          <div className="foot-note">
            <span>
              Testnet only. Rainfall is NASA POWER <span className="mono">PRECTOTCORR</span>.
            </span>
            <span className="muted">
              A demonstration of a mechanism, not a licensed insurer.
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
