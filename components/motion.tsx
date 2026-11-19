"use client";
import { useEffect, useRef, useState } from "react";

/** Counts up from 0 to `value` once, when first shown. */
export function CountUp({ value, duration = 900, decimals = 0, prefix = "", suffix = "" }: { value: number; duration?: number; decimals?: number; prefix?: string; suffix?: string }) {
  const [n, setN] = useState(0);
  const started = useRef(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const run = () => {
      if (started.current) return;
      started.current = true;
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setN(value * eased);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && run(), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);
  return <span ref={ref} className="tabular-nums">{prefix}{n.toFixed(decimals)}{suffix}</span>;
}

/** Live clock-ish greeting that renders on the client (avoids server/client time mismatch). */
export function Greeting({ name }: { name: string }) {
  const [g, setG] = useState("Hello");
  useEffect(() => {
    const h = new Date().getHours();
    setG(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");
  }, []);
  return <>{g}{name ? `, ${name}` : ""}</>;
}
