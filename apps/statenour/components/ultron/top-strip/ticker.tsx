"use client";

/**
 * THE EDGE FEED — the global ambient intelligence strip at the top of every
 * statenour page.
 *
 * 2026-05-31 · REBUILT (was a 55s CSS marquee at 10px). The marquee became
 * wallpaper you tuned out + was unreadable/untappable on a phone (pause +
 * dismiss were :hover-gated → dead on touch). New form (per the multi-agent
 * review · docs/specs/2026-05-31-edge-feed.md):
 *   · ONE item at a time — static, ≥13px, the whole strip is a ≥40px tap
 *     target that opens the full feed.
 *   · severity-first ordering so the highest-signal item leads (warn → win →
 *     info); a fade (not a slide) advances every 10s; pauses while the feed
 *     sheet is open.
 *   · a VISIBLE dismiss (touch-friendly, not hover-gated).
 *   · the full ranked feed opens in a tap-to-open sheet below the strip.
 *
 * Data still comes from `trpc.operator.ticker` (cached 60s, AI-free read
 * path); this is a pure presentation rebuild — the lanes/colors/glyphs are
 * preserved.
 */

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { UltronMode } from "@/lib/ultron/mode-classifier";

import { trpc } from "@/lib/trpc/client";
import { useDismissedTicker } from "@/hooks/use-dismissed-ticker";
import { DismissButton } from "@/components/ui/dismiss-button";

interface TickerItem {
  id: string;
  category: "market" | "macro" | "industry" | "local" | "timeline" | "mode" | "shop" | "brain";
  symbol?: string;
  label: string;
  deltaPct?: number | null;
  severity?: "info" | "warn" | "win";
  domain?: string;
  href?: string;
  at?: string;
}

const CATEGORY_COLORS: Record<TickerItem["category"], string> = {
  market: "text-emerald-400/80",
  macro: "text-blue-400/80",
  industry: "text-amber-400/80",
  local: "text-violet-400/70",
  timeline: "text-[var(--gold)]",
  mode: "text-[var(--text-primary)]",
  shop: "text-[var(--gold)]/90",
  brain: "text-violet-400",
};

const MODE_COLORS: Record<UltronMode, string> = {
  BATTLE: "text-red-400",
  SURGICAL: "text-[var(--gold)]",
  RECOVERY: "text-amber-400",
  SHUTDOWN: "text-blue-400",
  NORMAL: "text-[var(--text-tertiary)]",
};

const SEVERITY_COLORS: Record<NonNullable<TickerItem["severity"]>, string> = {
  warn: "text-amber-400",
  info: "text-[var(--gold)]/90",
  win: "text-emerald-400",
};

// Important-first: warn > win > info > (none). The mode item, when present,
// always leads (it's the operator's current operating state).
const SEVERITY_RANK: Record<string, number> = { warn: 0, win: 1, info: 2 };

// A dismissal from the top strip is a 24h snooze, not a permanent mute, so
// live/recurring lanes (market, shop) return tomorrow rather than being
// silently lost forever (Edge Feed spec — "snooze ≠ dismiss").
const SNOOZE_MS = 24 * 60 * 60 * 1000;

// Soft page-context boost: which lanes matter most on the current page.
// Applied as a tiebreaker AFTER mode + severity, so urgent items still lead
// globally — page context only reorders the calm middle (Edge Feed spec).
function pagePreferred(pathname: string | null): Set<string> {
  const p = pathname ?? "";
  if (p.startsWith("/business"))
    return new Set(["shop", "market", "macro"]);
  if (p.startsWith("/stats"))
    return new Set(["timeline", "brain"]);
  if (p.startsWith("/brain") || p.startsWith("/radar") || p.startsWith("/seo"))
    return new Set(["brain", "industry"]);
  if (p.startsWith("/journal")) return new Set(["timeline", "brain"]);
  return new Set<string>();
}

interface TickerProps {
  mode?: UltronMode;
  reason?: string;
}

export function Ticker({ mode, reason }: TickerProps = {}) {
  const { data } = trpc.operator.ticker.useQuery(undefined, {
    refetchInterval: 300_000,
    retry: false,
  });
  const { dismissed, dismiss } = useDismissedTicker();
  const pathname = usePathname();
  const pref = useMemo(() => pagePreferred(pathname), [pathname]);

  const items = useMemo<TickerItem[]>(() => {
    const base = (data?.items ?? []) as TickerItem[];
    const withMode =
      !mode || mode === "NORMAL"
        ? base
        : [
            {
              id: `mode-${mode}`,
              category: "mode" as const,
              symbol: mode,
              label: reason ?? mode.toLowerCase(),
            },
            ...base,
          ];
    const live = withMode.filter((it) => !dismissed.has(it.id));
    return [...live].sort((a, b) => {
      const am = a.category === "mode" ? -1 : 0;
      const bm = b.category === "mode" ? -1 : 0;
      if (am !== bm) return am - bm;
      const ar = SEVERITY_RANK[a.severity ?? ""] ?? 3;
      const br = SEVERITY_RANK[b.severity ?? ""] ?? 3;
      if (ar !== br) return ar - br;
      // Soft page-context boost — only reorders within a severity tier, so
      // an urgent item on an "off-topic" page still leads.
      const ap = pref.has(a.category) ? 0 : 1;
      const bp = pref.has(b.category) ? 0 : 1;
      return ap - bp;
    });
  }, [data, mode, reason, dismissed, pref]);

  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);

  // Auto-advance every 10s (fade-on-change via the item key below). Pauses
  // while the feed sheet is open. Motion only on change — no continuous
  // scroll to habituate to.
  useEffect(() => {
    if (open || items.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 10_000);
    return () => clearInterval(t);
  }, [open, items.length]);

  // Close the sheet on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (items.length === 0) {
    return (
      <div
        className="min-h-[36px] sm:h-7 border-b border-[var(--border-default)] bg-[var(--bg-void)]/60"
        aria-hidden
      />
    );
  }

  const safeIdx = idx % items.length;
  const current = items[safeIdx];

  return (
    <div className="relative border-b border-[var(--border-default)] bg-[var(--bg-void)]/60">
      <div className="flex items-center gap-2 px-3 min-h-[40px] sm:min-h-[28px]">
        {/* The one item · tap anywhere to open the full feed. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 min-w-0 flex items-center h-full py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40 rounded"
          aria-label={open ? "Close feed" : "Open feed"}
          aria-expanded={open}
        >
          <span key={current.id} className="edge-fade flex-1 min-w-0">
            <ItemView item={current} />
          </span>
        </button>

        {items.length > 1 && (
          <span
            className="shrink-0 text-[9px] tabular-nums text-[var(--text-tertiary)] select-none"
            aria-hidden
          >
            {safeIdx + 1}/{items.length}
          </span>
        )}

        {/* Visible, touch-friendly dismiss for the current item. */}
        <DismissButton
          onClick={(e) => {
            e.stopPropagation();
            dismiss(current.id, { kind: current.category, source: "top", ttlMs: SNOOZE_MS });
          }}
          label="Snooze item for a day"
          size="sm"
          className="shrink-0 hover:text-rose-400"
        />
      </div>

      {open && (
        <FeedSheet
          items={items}
          activeIdx={safeIdx}
          onClose={() => setOpen(false)}
          onDismiss={(id, cat) =>
            dismiss(id, { kind: cat, source: "top", ttlMs: SNOOZE_MS })
          }
          onPick={(i) => {
            setIdx(i);
            setOpen(false);
          }}
        />
      )}

      <style jsx>{`
        .edge-fade {
          animation: edgeFade 400ms ease-out;
        }
        @keyframes edgeFade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

/** Resolve an item's accent color (category, with severity/mode overrides). */
function itemColor(item: TickerItem): string {
  if (item.category === "mode") {
    const m = item.symbol as UltronMode | undefined;
    return m && m in MODE_COLORS ? MODE_COLORS[m] : CATEGORY_COLORS.mode;
  }
  if (item.severity && (item.category === "timeline" || item.category === "shop" || item.category === "brain")) {
    return SEVERITY_COLORS[item.severity];
  }
  return CATEGORY_COLORS[item.category];
}

const GLYPH: Partial<Record<TickerItem["category"], string>> = {
  timeline: "◆",
  shop: "●",
  mode: "▲",
  brain: "◉",
};

/** One item's content — readable (≥12px), single-line in the strip, wrapping
 *  in the sheet. Reused by the strip + the feed rows. */
function ItemView({ item, row = false }: { item: TickerItem; row?: boolean }) {
  const color = itemColor(item);
  const glyph = GLYPH[item.category];
  const delta =
    item.deltaPct === undefined || item.deltaPct === null
      ? null
      : item.deltaPct;
  const deltaColor =
    delta == null ? "" : delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-[var(--text-tertiary)]";
  const label = item.symbol
    ? item.label.replace(new RegExp(`^${item.symbol}\\s*`), "")
    : item.label;

  return (
    <span className={cn("inline-flex items-center gap-1.5 min-w-0", row ? "text-[12.5px]" : "text-[13px]", color)}>
      {glyph && <span className="shrink-0 opacity-75" aria-hidden>{glyph}</span>}
      {item.symbol && (
        <span className="shrink-0 font-bold uppercase tracking-wider text-[10px]">{item.symbol}</span>
      )}
      <span className={cn(row ? "" : "truncate", item.symbol && "text-[var(--text-secondary)]")}>{label}</span>
      {delta != null && (
        <span className={cn("shrink-0 tabular-nums", deltaColor)}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "·"}
          {Math.abs(delta).toFixed(1)}%
        </span>
      )}
    </span>
  );
}

/** The full feed — opens below the strip on tap. Every item readable +
 *  tappable (≥44px rows) with a visible dismiss. */
function FeedSheet({
  items,
  activeIdx,
  onClose,
  onDismiss,
  onPick,
}: {
  items: TickerItem[];
  activeIdx: number;
  onClose: () => void;
  onDismiss: (id: string, category: TickerItem["category"]) => void;
  onPick: (i: number) => void;
}) {
  return (
    <>
      {/* backdrop — tap outside to close */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div className="absolute left-0 right-0 top-full z-50 max-h-[60vh] overflow-y-auto border-b border-[var(--border-default)] bg-[var(--bg-void)]/95 backdrop-blur-sm shadow-xl">
        <div className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)]/50 bg-[var(--bg-void)]/95">
          <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            Feed · {items.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] px-2 min-h-[36px]"
          >
            Close
          </button>
        </div>
        <ul>
          {items.map((it, i) => (
            <li
              key={it.id}
              className={cn(
                "flex items-center gap-2 px-3 min-h-[44px] border-b border-[var(--border-default)]/25",
                i === activeIdx && "bg-white/[0.03]",
              )}
            >
              {it.href ? (
                <a
                  href={it.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 py-2 hover:brightness-150 transition-all"
                  onClick={onClose}
                >
                  <ItemView item={it} row />
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => onPick(i)}
                  className="flex-1 min-w-0 py-2 text-left"
                >
                  <ItemView item={it} row />
                </button>
              )}
              <DismissButton
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(it.id, it.category);
                }}
                label="Snooze item for a day"
                size="sm"
                className="shrink-0 hover:text-rose-400"
              />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
