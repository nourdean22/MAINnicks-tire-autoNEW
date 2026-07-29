"use client";

/**
 * BottomTabBar — the primary, always-visible navigation surface.
 *
 * 2026-06-18 · IA reorg Phase 4. Replaces the FloatingHome orb as primary
 * nav. 5 fixed slots: the 4 daily content tabs (BOTTOM_TABS, read from the
 * single NAV source) + a "More" slot that opens the MoreSheet. Fixed to the
 * bottom edge with iOS safe-area padding and 44px+ touch targets. The
 * ambient BottomPulseTicker rides as a thin strip directly above the tab row
 * so the whole bottom chrome is one stacked unit (no z-index overlap with
 * the old separately-fixed ticker).
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BOTTOM_TABS } from "./nav-items";
import { BottomPulseTicker } from "@/components/ultron/bottom-pulse-ticker";
import { MORE_SHEET_OPEN_EVENT } from "./more-sheet";
import { LayoutGrid } from "lucide-react";

function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function BottomTabBar() {
  const pathname = usePathname() ?? "/";
  const chromeRef = useRef<HTMLDivElement>(null);

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
        className="flex items-stretch border-t border-[var(--gold)]/20 bg-[var(--bg-void)]/95 backdrop-blur-xl"
      >
        {BOTTOM_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isActiveHref(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 transition-colors",
                active
                  ? "text-[var(--gold)]"
                  : "text-fg-tertiary hover:text-[var(--text-secondary)]",
              )}
            >
              {active && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gold" />
              )}
              <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
              <span className="text-[9px] font-medium uppercase tracking-[0.12em]">
                {tab.label}
              </span>
            </Link>
          );
        })}
        <button
          onClick={() => window.dispatchEvent(new Event(MORE_SHEET_OPEN_EVENT))}
          aria-label="More — all surfaces and search"
          className="relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-fg-tertiary transition-colors hover:text-gold"
        >
          <LayoutGrid size={20} strokeWidth={1.75} />
          <span className="text-[9px] font-medium uppercase tracking-[0.12em]">More</span>
        </button>
      </nav>
    </div>
  );
}
