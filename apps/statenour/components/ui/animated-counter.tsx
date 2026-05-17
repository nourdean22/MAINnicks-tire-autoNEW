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
 */

import { useEffect, useRef } from "react";
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
  const prevValue = useRef(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const initialNode = spanRef.current;
    if (!initialNode) return;

    const start = prevValue.current;
    const diff = value - start;

    // Identity tween (value didn't change · just sync the rendered text).
    if (diff === 0) {
      initialNode.textContent = `${prefix}${formatNum(value, decimals, locale)}${suffix}`;
      return;
    }

    const startTime = performance.now();

    function tick(now: number) {
      // Re-read the ref each frame · handles mid-animation unmount AND
      // satisfies TypeScript's narrowing-across-closure rules. If the
      // ref went null (unmount) the tick exits cleanly without writing
      // to a stale node.
      const node = spanRef.current;
      if (!node) return;
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutExpo(progress);
      const current = start + diff * eased;
      // Direct DOM write — bypasses React reconciliation.
      node.textContent = `${prefix}${formatNum(current, decimals, locale)}${suffix}`;
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        prevValue.current = value;
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration, decimals, locale, prefix, suffix]);

  // Initial paint shows "0" (per the original behavior — the dramatic
  // tween effect is "starts at zero, climbs to the real value"). The
  // useEffect overwrites this on mount.
  return (
    <span ref={spanRef} className={cn("tabular-nums", className)}>
      {prefix}0{suffix}
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
