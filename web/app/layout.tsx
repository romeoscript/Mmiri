import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mmiri — rainfall cover on NEAR",
  description:
    "A sealed-bid market where underwriter agents compete to price rainfall risk for smallholder farmers. Settled from NASA rainfall data; the policy is an NFT that carries the payout.",
};

const NAV = [
  { href: "/", label: "Request cover" },
  { href: "/rounds", label: "Rounds & underwriters" },
  { href: "/policies", label: "Policies" },
  { href: "/simulation", label: "Simulation" },
  { href: "/intents", label: "Pay from any chain" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="inner">
            <div className="brand">
              Mmiri<span>Igbo for water — and for rain</span>
            </div>
            <nav className="main">
              {NAV.map((n) => (
                <a key={n.href} href={n.href}>
                  {n.label}
                </a>
              ))}
            </nav>
          </div>
        </header>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
