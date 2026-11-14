"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

/**
 * Runs the page-load reveal for its `[data-animate]` children, once.
 *
 * Deliberately used in one place — the masthead of the home page — so the site has a
 * single opening moment rather than a fade-and-rise on every section, which is the
 * generic treatment and reads as filler. Children are hidden by CSS only while
 * `html.js-motion` is set, so no-JS and reduced-motion visitors see the finished page.
 */
export function Reveal({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-animate]",
        { opacity: 0, y: 14 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          ease: "power2.out",
          stagger: 0.09,
          clearProps: "transform",
        },
      );
    }, el);

    return () => ctx.revert();
  }, []);

  return <div ref={root}>{children}</div>;
}
