"use client";

/**
 * DesktopSpine · the desktop workspace rail.
 *
 * 2026-09-16 (Visible Transformation wave): desktop had NO navigation of its
 * own — a 1440px screen drove NOUR OS through the phone's bottom tab bar. The
 * spine is the desktop's spatial frame: a fixed rail on the left at ≥1280px
 * with the eight surfaces the operator lives in, the Resolver (⌘K) and the
 * full launcher. `<main>` pads left by `--spine-w` (base.css: 3.75rem at
 * ≥1280px, 0 below) so no page control ever sits under it; below xl it does
 * not render at all and the bottom tab bar stays the primary nav.
 *
 * 2026-10-01 (UI v2 · Precision Material Cockpit): the rail recedes. 60px,
 * icon-led, labels in the accessible name + native tooltip instead of 11px
 * uppercase mono under every icon; the active surface is a brighter icon on
 * a raised step plus ONE gold signal notch — no gold text, no gold hover.
 * Translucent material because it is control chrome (docs/design/ui-v2/SYSTEM.md §11).
 *
 * The bottom tab bar keeps `aria-label="Primary"` — the e2e suite derives
 * the bottom chrome from it — so this nav is "Workspace", and its launcher
 * button carries a different accessible name from the tab bar's "More".
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Command, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV } from "./nav-items";
import { useMoreSheetStore } from "@/lib/state/more-sheet-store";
import { COMMAND_PALETTE_OPEN_EVENT } from "@/components/command-palette";

const SPINE_HREFS = ["/", "/chat", "/missions", "/journal", "/brain", "/people", "/system", "/stats"] as const;

/** The spine's eight surfaces, in the order they sit on the rail — read from the single NAV source. */
export const SPINE_ITEMS = SPINE_HREFS.flatMap((href) => {
  const item = NAV.find((n) => n.href === href);
  return item ? [item] : [];
});

function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** One rail control: a 44px square, radius-control, state through colour + the notch only. */
const RAIL_ITEM =
  "group relative flex h-11 w-11 items-center justify-center rounded-control transition-colors duration-[var(--motion-state)] ease-[var(--ease-standard)]";
const RAIL_IDLE = "text-fg-tertiary hover:bg-surface hover:text-fg-secondary";
const RAIL_ACTIVE = "bg-surface-interactive text-fg";

export function DesktopSpine() {
  const pathname = usePathname() ?? "/";
  const openMoreSheet = useMoreSheetStore((s) => s.openSheet);

  return (
    <aside
      data-spine="desktop"
      aria-label="Workspace rail"
      className="ui-material fixed bottom-[var(--bottom-chrome-h,6rem)] left-0 top-0 z-[52] hidden w-[var(--spine-w,4.5rem)] flex-col items-center border-r border-edge-subtle xl:flex"
    >
      <Link
        href="/"
        aria-label="NOUR OS home"
        className="flex h-14 w-full shrink-0 items-center justify-center font-display text-xl font-bold tracking-tight text-gold"
      >
        N
      </Link>
      <nav aria-label="Workspace" className="flex flex-1 flex-col items-center gap-1 pt-1">
        {SPINE_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActiveHref(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              title={item.label}
              className={cn(RAIL_ITEM, active ? RAIL_ACTIVE : RAIL_IDLE)}
            >
              {active && (
                <span
                  className="notch absolute -left-2 top-1/2 h-4 -translate-y-1/2"
                  aria-hidden
                />
              )}
              <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col items-center gap-1 pb-3">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT))}
          aria-label="Resolve — search, act or inspect anything (⌘K)"
          title="Resolve · ⌘K"
          className={cn(RAIL_ITEM, RAIL_IDLE)}
        >
          <Command size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={openMoreSheet}
          aria-label="All surfaces"
          title="All surfaces"
          className={cn(RAIL_ITEM, RAIL_IDLE)}
        >
          <LayoutGrid size={18} strokeWidth={1.75} />
        </button>
      </div>
    </aside>
  );
}
