"use client";

/**
 * BottomTabBar — the primary, always-visible navigation surface.
 *
 * 2026-06-18 · IA reorg Phase 4. Replaces the FloatingHome orb as primary
 * nav. 5 slots: 3 fixed daily tabs (FIXED_TABS, read from the single NAV
 * source), one pinned slot (default Journal; the operator pins any flat More
 * row from the sheet, UI v3 W1b) + a "Command" slot that opens the MoreSheet.
 * Below XL it is the primary nav; at XL the DesktopSpine takes over and this
 * nav row hides.
 * The ambient BottomPulseTicker stays visible as a thin signal strip
 * so the whole bottom chrome is one stacked unit (no z-index overlap with
 * the old separately-fixed ticker).
 */

import { focusClearanceDelta, scrollClear } from "@/lib/ui/focus-clearance";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { FIXED_TABS, NAV, resolvePinnedTab } from "./nav-items";
import { BottomPulseTicker } from "@/components/ultron/bottom-pulse-ticker";
import { useMoreSheetStore } from "@/lib/state/more-sheet-store";
import { usePinnedTabStore } from "@/lib/state/pinned-tab-store";
// Search, not lucide's Command (the Mac glyph means nothing on an iPhone): the slot's first row is
// "Search everything", and search-as-a-tab is the mechanism (Apple, 2026-06-08).
import { Search } from "lucide-react";

function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function BottomTabBar() {
  const pathname = usePathname() ?? "/";
  const chromeRef = useRef<HTMLDivElement>(null);
  const openMoreSheet = useMoreSheetStore((s) => s.openSheet);
  const pinnedHref = usePinnedTabStore((s) => s.href);
  const hydratePinnedTab = usePinnedTabStore((s) => s.hydrate);
  // Server and first client render show Journal; the stored pin lands after mount (no mismatch).
  useEffect(() => {
    hydratePinnedTab();
  }, [hydratePinnedTab]);
  const tabs = [...FIXED_TABS, resolvePinnedTab(pinnedHref, NAV)];

  /**
   * 2026-07-29 · Publish the chrome's REAL height into --bottom-chrome-h.
   *
   * The token was a hardcoded 6rem (96px) that a human had to remember to
   * update — and the stack's height is content-dependent, so the contract
   * broke silently: measured at 390px the tab row is ~53px, leaving ~43px
   * for the ticker, whose strip is `min-h-[32px]` (a MINIMUM, uncapped) and
   * whose text does not truncate in row mode. A longer pulse line wraps,
   * the strip grows past the reservation, and the chrome paints over the
   * chat composer — which is exactly what the operator hit.
   *
   * Measuring makes the invariant structural instead of remembered: pages
   * reserve exactly what is rendered, whatever the ticker says. The CSS
   * default stays as the SSR / first-paint fallback.
   */
  useEffect(() => {
    const el = chromeRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const h = el.getBoundingClientRect().height;
      // Never publish 0 — a collapsed measurement would un-reserve the
      // whole chrome and hide content behind it.
      if (h > 0) {
        document.documentElement.style.setProperty(
          "--bottom-chrome-h",
          `${Math.ceil(h)}px`,
        );
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Section 5.8 / WCAG 2.4.11 (2026-09-08): a control focused while it sits under this fixed
  // chrome is scrolled clear of it. Chromium does not scroll a focused control that is already
  // inside the viewport, so scroll-padding-bottom (base.css) covers scrollIntoView callers but
  // not keyboard focus — measured on /journal in CI before this handler existed.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      const chrome = chromeRef.current;
      if (!(el instanceof HTMLElement) || !chrome || chrome.contains(el)) return;
      const delta = focusClearanceDelta(el.getBoundingClientRect(), chrome.getBoundingClientRect().top, window.innerHeight);
      if (delta > 0) scrollClear(el, delta);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  return (
    <div
      ref={chromeRef}
      /* Height contract: --bottom-chrome-h is now MEASURED from this
         element (see the effect above), so the bar + ticker stack can
         change height without stranding per-page padding. */
      className="fixed bottom-0 left-0 right-0 z-[55]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Ambient brain-signal ticker rides above the tab row. */}
      <BottomPulseTicker />
      <nav
        aria-label="Primary"
        className="ui-material flex items-stretch border-t border-edge-subtle xl:hidden"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActiveHref(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 py-1.5 press-spring",
                active ? "text-fg" : "text-fg-tertiary hover:text-fg-secondary",
              )}
            >
              {/* UI v2: the signal notch is the only gold on the bar — one mark, no gold text. */}
              {active && <span className="absolute top-0 h-0.5 w-6 rounded-full bg-accent" aria-hidden />}
              <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
              <span className="text-[11px] font-medium leading-none">{tab.label}</span>
            </Link>
          );
        })}
        {/* Command: the same visual grammar as the tabs, never the notch (it is not a page). */}
        <button
          type="button"
          onClick={openMoreSheet}
          aria-label="Command: all surfaces and search"
          aria-haspopup="dialog"
          className="relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 py-1.5 text-fg-tertiary press-spring hover:text-fg-secondary"
        >
          <Search size={20} strokeWidth={1.75} />
          <span className="text-[11px] font-medium leading-none">Command</span>
        </button>
      </nav>
    </div>
  );
}
