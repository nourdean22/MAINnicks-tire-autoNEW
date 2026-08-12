"use client";

/**
 * MoreSheet — the "More" launcher behind the 5th bottom-tab slot.
 *
 * 2026-06-18 · IA reorg Phase 4. Replaces the FloatingHome orb's expanded
 * menu. A full-height, thumb-scrollable bottom sheet that indexes every
 * surface NOT in the 4 bottom tabs, grouped by the operator's OS-loop verbs
 * (Capture · Execute · Reflect · Money · Operate) read straight from the
 * single NAV source (nav-items.ts `bySection`). Top of the sheet is a
 * Search button — the only tap-path to ⌘K on the keyboardless iOS PWA.
 *
 * 2026-08-12 · two fixes, operator-reported ("stale UI and architecture"):
 *   · Open state now lives in useMoreSheetStore (Zustand — matches the
 *     chat-ui-store precedent) instead of a raw window CustomEvent bus.
 *   · The sheet only ever animated IN — every close path unmounted on the
 *     same frame the store flipped `open`, so it visibly snapped away.
 *     `mounted` now trails `open` by one animation frame (fadeSlideDown,
 *     unmount on animationend) so open and close are symmetric.
 *   · The five verb sections were five identical gray labels. They ARE a
 *     real sequence (the operator's own OS-loop), so that's now the one
 *     structural device: an ordinal badge (01–05) in the display face,
 *     replacing the flat mono tertiary label.
 */

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV, bySection, type NavSection } from "./nav-items";
import { useMoreSheetStore } from "@/lib/state/more-sheet-store";
import { useRecentPages } from "@/lib/hooks/use-recent-pages";
import { useSystemPulse } from "@/lib/hooks/use-system-pulse";
import { pickSmartNow } from "@/lib/floating-home/smart-now";
import { COMMAND_PALETTE_OPEN_EVENT } from "@/components/command-palette";
import { CAPTURE_OPEN_EVENT } from "@/components/brain-dump-modal";
import { Search, NotebookPen, ArrowRight, Clock } from "lucide-react";

const SECTIONS: { key: NavSection; label: string; ordinal: string }[] = [
  { key: "capture", label: "Capture", ordinal: "01" },
  { key: "execute", label: "Execute", ordinal: "02" },
  { key: "reflect", label: "Reflect", ordinal: "03" },
  { key: "money", label: "Money", ordinal: "04" },
  { key: "operate", label: "Operate", ordinal: "05" },
];

function isActiveHref(pathname: string, href: string): boolean {
  const base = href.split("?")[0].split("#")[0];
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(base + "/");
}

export function MoreSheet() {
  const open = useMoreSheetStore((s) => s.open);
  const close = useMoreSheetStore((s) => s.closeSheet);
  // `mounted` trails `open` by one exit-animation frame — this is what
  // makes closing symmetric with opening instead of an instant unmount.
  const [mounted, setMounted] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname() ?? "/";
  const pulse = useSystemPulse();
  const smartNow = pickSmartNow({ pathname, pulse });
  const { candidates: recentCandidates } = useRecentPages();

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Auto-close on route change (a no-op via closeSheet if already closed).
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!mounted) return null;

  const footer = NAV.filter((n) => n.footer);

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="More navigation"
    >
      {/* Scrim — fades with the sheet since both key off the same `open`. */}
      <button
        aria-label="Close menu"
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={close}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        onAnimationEnd={() => {
          if (!open) setMounted(false);
        }}
        className={cn(
          "relative max-h-[86vh] overflow-y-auto rounded-t-2xl border-t border-[var(--gold)]/30 bg-[var(--bg-void)] pb-[env(safe-area-inset-bottom,12px)]",
          // Depth shadow (unchanged) layered with a soft top-edge gold glow
          // — the same composition --shadow-gold-strong uses, applied here
          // as literal values since Tailwind arbitrary shadows can't nest a
          // comma-bearing var() inside another arbitrary value.
          "shadow-[0_-20px_60px_rgba(0,0,0,0.7),0_-1px_30px_rgba(253,185,19,0.06)]",
          open ? "animate-fadeSlideUp" : "animate-fadeSlideDown",
        )}
      >
        {/* Sticky header: grab handle + Search */}
        <div className="sticky top-0 z-10 border-b border-[var(--border-default)] bg-[var(--bg-void)] px-4 pb-3 pt-2">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--border-default)]" />
          <button
            onClick={() => {
              window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
              close();
            }}
            className="flex w-full items-center gap-2 rounded-xl border border-[var(--gold)]/30 bg-[var(--bg-raised)]/40 px-3 py-2.5 text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/60 hover:text-[var(--gold)]"
          >
            <Search size={16} className="shrink-0" />
            <span className="text-sm">Search everything…</span>
            <kbd className="ml-auto hidden font-mono text-[9px] text-[var(--text-tertiary)] sm:inline">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Smart-now + Recent + Capture */}
        <div className="space-y-1 px-3 py-2">
          {smartNow && (
            <Link
              href={smartNow.href}
              onClick={close}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors",
                smartNow.urgency === "high"
                  ? "bg-rose-500/[0.08] text-rose-200 hover:bg-rose-500/15"
                  : smartNow.urgency === "medium"
                    ? "bg-amber-500/[0.06] text-amber-200 hover:bg-amber-500/15"
                    : "bg-[var(--gold)]/[0.05] text-[var(--gold)]/80 hover:bg-[var(--gold)]/15",
              )}
              title={`${smartNow.reason} · tap to jump`}
            >
              {smartNow.emoji && (
                <span className="shrink-0 text-[13px]" aria-hidden>
                  {smartNow.emoji}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-mono uppercase tracking-wider opacity-60">
                  Now
                </div>
                <div className="truncate text-[11px] font-medium">{smartNow.label}</div>
              </div>
              <ArrowRight size={12} className="shrink-0 opacity-60" />
            </Link>
          )}

          {recentCandidates.length > 0 && (
            <div className="rounded-lg bg-[var(--bg-raised)]/30 px-2 py-1.5">
              <div className="mb-1 flex items-center gap-1">
                <Clock size={9} className="text-[var(--text-tertiary)]" />
                <span className="font-mono text-[8px] uppercase tracking-wider text-[var(--text-tertiary)]">
                  recent
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {recentCandidates.map((r) => (
                  <Link
                    key={r.href}
                    href={r.href}
                    onClick={close}
                    className="max-w-[140px] truncate rounded-full border border-[var(--border-default)] bg-[var(--bg-base)]/40 px-2 py-0.5 font-mono text-[9px] text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/30 hover:bg-[var(--gold)]/10 hover:text-[var(--gold)]"
                    title={r.href}
                  >
                    {r.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => {
              window.dispatchEvent(new Event(CAPTURE_OPEN_EVENT));
              close();
            }}
            className="flex w-full items-center gap-3 rounded-lg border-l-2 border-l-transparent px-3 py-2 text-xs text-[var(--text-secondary)] transition-colors hover:border-l-[var(--gold)] hover:bg-[var(--gold)]/10 hover:text-[var(--gold)]"
            aria-label="Capture a thought (⌘⇧J)"
          >
            <NotebookPen size={15} strokeWidth={1.75} />
            <span className="text-[10px] font-medium uppercase tracking-[0.15em]">Capture</span>
            <kbd className="ml-auto hidden font-mono text-[8px] text-[var(--text-tertiary)] sm:inline">
              ⌘⇧J
            </kbd>
          </button>
        </div>

        {/* Verb sections — read from the single NAV source */}
        {SECTIONS.map(({ key, label, ordinal }) => {
          const rows = bySection(key);
          if (rows.length === 0) return null;
          return (
            <div key={key} className="border-t border-[var(--border-default)] px-3 py-2">
              {/* 2026-08-12 · Capture -> Execute -> Reflect -> Money ->
                  Operate is a real sequence (the operator's own OS loop),
                  not five arbitrary buckets — the ordinal makes that
                  legible instead of five identical gray labels. */}
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <span
                  aria-hidden
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--gold)]/25 bg-[var(--gold-ghost)] font-mono text-[8px] text-[var(--gold)]/80"
                >
                  {ordinal}
                </span>
                <span className="font-[var(--font-display)] text-[12px] font-semibold uppercase tracking-[0.15em] text-[var(--text-secondary)]">
                  {label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {rows.map((n) => {
                  const Icon = n.icon;
                  const active = isActiveHref(pathname, n.href);
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors",
                        active
                          ? "bg-[var(--gold)]/10 text-[var(--gold)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      <Icon size={15} strokeWidth={active ? 2.25 : 1.75} className="shrink-0" />
                      <span className="truncate text-[10px] font-medium uppercase tracking-[0.1em]">
                        {n.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Footer — Settings + external Admin */}
        <div className="flex items-center gap-2 border-t border-[var(--border-default)] px-3 py-3">
          {footer.map((n) => {
            const Icon = n.icon;
            const className =
              "flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--border-default)] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/30 hover:text-[var(--gold)]";
            if (n.external) {
              return (
                <a
                  key={n.href}
                  href={n.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                  className={className}
                >
                  <Icon size={14} strokeWidth={1.75} />
                  {n.label}
                  <span aria-hidden className="text-[8px] text-[var(--text-tertiary)]">
                    ↗
                  </span>
                </a>
              );
            }
            return (
              <Link key={n.href} href={n.href} onClick={close} className={className}>
                <Icon size={14} strokeWidth={1.75} />
                {n.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
