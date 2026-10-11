"use client";

/**
 * AnimatedCounter · v10.0.456
 *
 * Tweens between numeric values with easeOutExpo curve.
 *
 * v10.0.456 · motion+a11y audit Finding M2 · refactored from
 * `useState`-driven rAF loop to direct DOM-write via ref. The
 * previous implementation called setDisplay() inside the rAF tick
 * (~60/sec for the 800ms default duration = ~48 React renders per
 * counter per animation). On pages that animate 5-10 counters
 * simultaneously (mastery, system, tasks), that was 240-480
 * concurrent React reconciliations in 800ms. React 18 batches them
 * but each still schedules a render priority slot.
 *
 * Direct DOM-write via `node.textContent` bypasses React entirely
 * inside the tick loop — zero reconciliation cost between the
 * mount paint and the final paint. The component still re-renders
 * when the `value` prop changes (cleanup + restart) but no longer
 * re-renders FOR EACH FRAME of the in-flight animation.
 *
 * Tradeoff: we now bypass React's text node management. Safe here
 * because the span is a simple text-only leaf — no React-managed
 * children, no event handlers on inner elements. If a future change
 * adds React children inside the span, this implementation needs
 * to be re-evaluated.
 *
 * 2026-10-10 · the first paint is the REAL value. It used to be a literal
 * 0 that only a requestAnimationFrame tick replaced, and a hidden or
 * background document runs no frames, so /system/crons tiles read 0 while
 * the header read the truth. Now: render the value, tween only on a later
 * change, and only when the page is visible and motion is allowed.
 */

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
  /** Format with commas (e.g., 1,234) */
  locale?: boolean;
}

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function AnimatedCounter({
  value,
  duration = 800,
  prefix = "",
  suffix = "",
  decimals = 0,
  className,
  locale = true,
}: AnimatedCounterProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  // The first paint is already the real value: nothing to tween from.
  const prevValue = useRef(value);
  const frameRef = useRef<number>(0);

  // Layout effect, so a tween's start value lands before the browser paints
  // (no flash of the target, then the old value, then the climb).
  useLayoutEffect(() => {
    // React's own text node: a single string child is one text node, and
    // writing its nodeValue keeps React and the DOM on the same node.
    const node = spanRef.current?.firstChild;
    if (!node) return;
    const text = (n: number) => `${prefix}${formatNum(n, decimals, locale)}${suffix}`;
    const start = prevValue.current;
    prevValue.current = value;
    const animate =
      start !== value &&
      !document.hidden &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Always settle the text: a dep change that kept `value` (or a cancelled
    // tween) must not leave a mid-tween number behind.
    node.nodeValue = text(animate ? start : value);
    if (!animate) return;

    const diff = value - start;
    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      node.nodeValue = text(start + diff * easeOutExpo(progress));
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration, decimals, locale, prefix, suffix]);

  // One string child = one text node (see the effect).
  return (
    <span ref={spanRef} className={cn("tabular-nums", className)}>
      {`${prefix}${formatNum(value, decimals, locale)}${suffix}`}
    </span>
  );
}

function formatNum(n: number, decimals: number, locale: boolean): string {
  const fixed = decimals > 0 ? n.toFixed(decimals) : Math.round(n).toString();
  if (!locale) return fixed;
  const parts = fixed.split(".");
  parts[0] = Number(parts[0]).toLocaleString();
  return parts.join(".");
}
