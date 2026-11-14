"use client";

import { useEffect, useRef } from "react";

/**
 * Rain, behind the hero.
 *
 * Canvas rather than a stack of animated DOM nodes: a few hundred moving streaks on the
 * compositor is cheap, the same thing in elements is not. It is deliberately faint —
 * this is weather over the page, and the moment anyone notices it instead of the
 * headline it has failed.
 *
 * Stops when the tab is hidden, when it scrolls out of view, and entirely under reduced
 * motion, where it renders nothing at all rather than a still frame of fake rain.
 */
export function RainField() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    let w = 0;
    let h = 0;
    let dpr = 1;

    type Drop = { x: number; y: number; len: number; v: number; a: number };
    let drops: Drop[] = [];

    const seed = () => {
      const count = Math.round(Math.min(160, Math.max(40, w / 11)));
      drops = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        len: 8 + Math.random() * 22,
        v: 90 + Math.random() * 190,
        a: 0.06 + Math.random() * 0.2,
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    let last = performance.now();
    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      for (const d of drops) {
        d.y += d.v * dt;
        // A slight drift, so it reads as weather rather than a screensaver.
        d.x += 14 * dt;
        if (d.y - d.len > h) {
          d.y = -d.len;
          d.x = Math.random() * w;
        }
        if (d.x > w) d.x = 0;
        ctx.strokeStyle = `rgba(111, 201, 222, ${d.a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 2, d.y - d.len);
        ctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    resize();
    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    // Not worth a single frame once it has scrolled past.
    const io = new IntersectionObserver(
      ([e]) => (e && e.isIntersecting ? start() : stop()),
      { threshold: 0 },
    );
    io.observe(canvas);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="rain-field" aria-hidden="true" />;
}
