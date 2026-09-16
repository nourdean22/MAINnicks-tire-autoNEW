"use client";

/**
 * DesktopSpine · the desktop workspace rail · 2026-09-16 (Visible
 * Transformation wave).
 *
 * Before this, desktop had NO navigation of its own: a 1440px screen drove
 * NOUR OS through the phone's bottom tab bar. The spine is the desktop's
 * spatial frame — a fixed 4rem rail on the left at ≥1280px with the eight
 * surfaces the operator lives in, the Resolver (⌘K) and the full launcher.
 * `<main>` pads left by `--spine-w` (base.css publishes 4.5rem at ≥1280px,
 * 0 below) so no page control ever sits under it; below xl it does not
 * render at all and the bottom tab bar stays the primary nav.
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

const RAIL_ITEM =
  "relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-md transition-colors";

export function DesktopSpine() {
  const pathname = usePathname() ?? "/";
  const openMoreSheet = useMoreSheetStore((s) => s.openSheet);

  return (
    <aside
      data-spine="desktop"
      aria-label="Workspace rail"
      className="fixed bottom-[var(--bottom-chrome-h,6rem)] left-0 top-0 z-[52] hidden w-[var(--spine-w,4.5rem)] flex-col items-stretch border-r border-edge bg-void xl:flex"
    >
      <Link
        href="/"
        aria-label="NOUR OS home"
        className="flex h-16 shrink-0 items-center justify-center border-b border-edge font-display text-2xl font-bold tracking-tight text-gold"
      >
        N
      </Link>
      <nav aria-label="Workspace" className="flex flex-1 flex-col items-stretch gap-0.5 px-1.5 pt-2">
        {SPINE_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActiveHref(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.label}
              className={cn(RAIL_ITEM, active ? "text-gold" : "text-fg-tertiary hover:text-fg")}
            >
              {active && <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-gold" aria-hidden />}
              <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
              <span className="max-w-full truncate font-mono text-[11px] uppercase tracking-[0.04em]">{item.label.split(" ")[0]}</span>
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col items-stretch gap-0.5 px-1.5 pb-3">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT))}
          aria-label="Resolve — search, act or inspect anything (⌘K)"
          title="Resolve · ⌘K"
          className={cn(RAIL_ITEM, "text-fg-tertiary hover:text-gold")}
        >
          <Command size={18} strokeWidth={1.75} />
          <span className="font-mono text-[11px] uppercase tracking-[0.08em]">⌘K</span>
        </button>
        <button
          type="button"
          onClick={openMoreSheet}
          aria-label="All surfaces"
          title="All surfaces"
          className={cn(RAIL_ITEM, "text-fg-tertiary hover:text-fg")}
        >
          <LayoutGrid size={18} strokeWidth={1.75} />
          <span className="font-mono text-[11px] uppercase tracking-[0.08em]">All</span>
        </button>
      </div>
    </aside>
  );
}
