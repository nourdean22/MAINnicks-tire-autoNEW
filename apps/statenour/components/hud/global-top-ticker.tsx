"use client";

/**
 * GLOBAL TOP TICKER — wraps the existing Ultron <Ticker /> but mounts
 * globally and skips when the page is HQ (Ultron already mounts its
 * own TopStrip with the ticker built in — would render twice).
 *
 * v7.4 · Apr 29 · Replaces the NotificationCenter bell as the primary
 * "what's going on" surface. The ticker scrolls market data, macro
 * headlines, mode chips, and (now) priority alerts pulled from the
 * pulse-digest stream. Combined with the BottomPulseTicker (mounted
 * in the same layout), Nour gets two persistent strips of awareness
 * across every page — top for OUTSIDE world, bottom for personal
 * brain state — and no bell competing for attention.
 *
 * Rendering rule: shows everywhere EXCEPT exact path "/" (HQ owns its
 * own TopStrip). On every other page, sticky at the very top.
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
  // HQ already has its own ticker inside TopStrip — skip to avoid dupes.
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
