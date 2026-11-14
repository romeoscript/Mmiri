"use client";

import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Request cover" },
  { href: "/rounds", label: "Rounds & underwriters" },
  { href: "/policies", label: "Policies" },
  { href: "/simulation", label: "Simulation" },
  { href: "/intents", label: "Pay from any chain" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="main">
      {NAV.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        return (
          <a key={n.href} href={n.href} aria-current={active ? "page" : undefined}>
            {n.label}
          </a>
        );
      })}
    </nav>
  );
}
