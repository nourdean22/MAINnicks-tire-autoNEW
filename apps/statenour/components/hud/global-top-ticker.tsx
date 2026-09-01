"use client";

/**
 * GLOBAL TOP TICKER — wraps the existing Ultron <Ticker /> but mounts
 * globally and skips on the home launcher ("/"), which is a lean
 * landing surface with its own HomeStatePulse strip (+ the bottom
 * pulse ticker) — a third top strip would crowd it.
 * (Historical note: the original skip existed to avoid double-mounting
 * under the deleted /ultron HQ TopStrip; that route is gone, but home
 * stays intentionally lean so the suppression remains.)
 *
 * v7.4 · Apr 29 · Replaces the NotificationCenter bell as the primary
 * "what's going on" surface. The ticker scrolls market data, macro
 * headlines, mode chips, and (now) priority alerts pulled from the
 * pulse-digest stream. Combined with the BottomPulseTicker (mounted
 * in the same layout), Nour gets two persistent strips of awareness
 * across every page — top for OUTSIDE world, bottom for personal
 * brain state — and no bell competing for attention.
 *
 * Rendering rule: shows everywhere EXCEPT the home launcher "/" (it has
 * its own HomeStatePulse + the bottom ticker). On every other page,
 * sticky at the very top.
 *
 * v10.0.528 · a11y A6 fix · wraps the sticky shell in role="region"
 * + aria-label="Live alerts" so screen-reader users get a landmark
 * to jump to / skip past. aria-live="off" is explicit — the inner
 * marquee items rotate every ~55s and we never want them announced.
 */

import { usePathname } from "next/navigation";
import { Ticker } from "@/components/ultron/top-strip/ticker";

export function GlobalTopTicker() {
  const pathname = usePathname();
  // Home is the lean launcher (its own BriefStateLine health line + the
  // bottom pulse ticker) — skip the global top ticker there so the landing
  // surface stays uncluttered.
  if (pathname === "/") return null;

  return (
    // May 02 · iPhone safe-area · `viewport-fit: cover` is set in
    // app/layout.tsx so on devices with a notch the status bar overlays
    // the page. Without pt:env(safe-area-inset-top), the ticker sat
    // UNDER the status bar — visually a transparent strip above the
    // colored ticker. Padding extends the backdrop into the inset
    // zone so the dark strip + blur cover the entire top region.
    <div
      role="region"
      aria-label="Live alerts"
      aria-live="off"
      className="sticky top-0 z-[55] backdrop-blur-xl bg-[var(--bg-void)]/85 border-b border-[var(--border-default)]"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <Ticker />
    </div>
  );
}
