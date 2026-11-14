"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Scroll-triggered motion, used sparingly and only where it carries meaning.
 *
 * `Rise` brings a block in as it arrives. `CountUp` runs a figure up to its value, which
 * is the one case where animating a number earns its keep: the eye reads the climb as
 * magnitude before it reads the digits.
 *
 * Both no-op under reduced motion, and both render their finished state in the markup so
 * nothing depends on the script arriving.
 */

function reduced() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Rise({
  children,
  stagger = 0,
  className,
}: {
  children: React.ReactNode;
  stagger?: number;
  className?: string;
}) {
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || reduced()) return;

    const ctx = gsap.context(() => {
      const targets = stagger ? Array.from(el.children) : [el];
      gsap.fromTo(
        targets,
        { opacity: 0, y: 24 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: "power2.out",
          stagger,
          clearProps: "transform",
          scrollTrigger: { trigger: el, start: "top 85%", once: true },
        },
      );
    }, el);

    return () => ctx.revert();
  }, [stagger]);

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}

export function CountUp({
  value,
  decimals = 0,
  suffix = "",
  prefix = "",
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  // Rendered at the final value, so no-JS and reduced motion are already correct.
  const [text] = useState(() => `${prefix}${value.toFixed(decimals)}${suffix}`);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;

    const ctx = gsap.context(() => {
      const box = { v: 0 };
      gsap.to(box, {
        v: value,
        duration: 1.1,
        ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 90%", once: true },
        onUpdate: () => {
          el.textContent = `${prefix}${box.v.toFixed(decimals)}${suffix}`;
        },
        onComplete: () => {
          el.textContent = `${prefix}${value.toFixed(decimals)}${suffix}`;
        },
      });
    }, el);

    return () => ctx.revert();
  }, [value, decimals, suffix, prefix]);

  return <span ref={ref}>{text}</span>;
}
