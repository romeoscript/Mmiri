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

/**
 * One pass of scroll choreography for the whole page.
 *
 * Mounted once; it picks up `[data-reveal]` anywhere below it and animates each by the
 * technique named in the attribute, so a heading does not arrive the same way a card or
 * a panel does. One identical entrance repeated down a page reads as filler; different
 * materials moving differently reads as authored.
 *
 * The hidden state is set from JavaScript rather than CSS, so a visitor without it — or
 * with reduced motion — gets the finished page and never a blank one.
 */
export function Choreography() {
  useEffect(() => {
    if (reduced()) return;

    const ctx = gsap.context(() => {
      const trigger = (el: Element) => ({
        trigger: el,
        start: "top 88%",
        once: true,
      });

      // Headings wipe up from their own baseline rather than drifting in.
      document.querySelectorAll("[data-reveal='clip']").forEach((el) => {
        gsap.set(el, { clipPath: "inset(0 0 100% 0)", y: 10 });
        gsap.to(el, {
          clipPath: "inset(0 0 -12% 0)",
          y: 0,
          duration: 0.85,
          ease: "power3.out",
          scrollTrigger: trigger(el),
        });
      });

      // Panels settle: a touch of scale and blur coming off, like focus being found.
      document.querySelectorAll("[data-reveal='settle']").forEach((el) => {
        gsap.set(el, { opacity: 0, y: 26, scale: 0.985, filter: "blur(6px)" });
        gsap.to(el, {
          opacity: 1,
          y: 0,
          scale: 1,
          filter: "blur(0px)",
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: trigger(el),
          clearProps: "filter,transform",
        });
      });

      // Groups deal themselves out one after another.
      document.querySelectorAll("[data-reveal='deal']").forEach((el) => {
        const kids = Array.from(el.children);
        if (kids.length === 0) return;
        gsap.set(kids, { opacity: 0, y: 30 });
        gsap.to(kids, {
          opacity: 1,
          y: 0,
          duration: 0.65,
          ease: "power2.out",
          stagger: 0.09,
          scrollTrigger: trigger(el),
          clearProps: "transform",
        });
      });

      // The land drifts slower than the page, and the weather slower still, so the hero
      // gains a little depth as it leaves rather than sliding off as one flat plate.
      const photo = document.querySelector(".hero-photo .hero-media img");
      if (photo) {
        gsap.fromTo(
          photo,
          { yPercent: -6, scale: 1.08 },
          {
            yPercent: 6,
            ease: "none",
            scrollTrigger: {
              trigger: ".hero-photo",
              start: "top top",
              end: "bottom top",
              scrub: 0.5,
            },
          },
        );
      }
      const rain = document.querySelector(".hero-photo .rain-field");
      if (rain) {
        gsap.to(rain, {
          yPercent: 16,
          ease: "none",
          scrollTrigger: {
            trigger: ".hero-photo",
            start: "top top",
            end: "bottom top",
            scrub: 0.75,
          },
        });
      }
    });

    // Late-arriving fonts and the chart change element heights under the triggers.
    const t = setTimeout(() => ScrollTrigger.refresh(), 600);

    return () => {
      clearTimeout(t);
      ctx.revert();
    };
  }, []);

  return null;
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
