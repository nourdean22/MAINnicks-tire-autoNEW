"use client";

/**
 * AMBIENT TICKER — scrolling strip of markets + macro headlines +
 * (v3) current Ultron MODE when it's non-NORMAL.
 *
 * Sits thin at the very top of Ultron. CSS-only infinite scroll (marquee)
 * — no JS animation loop burning cycles. Duplicates the items once inline
 * so the scroll seam is invisible.
 *
 * MODE placement rationale: the old standalone ModePill ate header real
 * estate even when idle (NORMAL = most of the time). Moving it into the
 * ticker means it only surfaces when meaningful (BATTLE/SURGICAL/
 * RECOVERY/SHUTDOWN), and it scrolls past naturally rather than camping
 * next to the wordmark.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { UltronMode } from "@/lib/ultron/mode-classifier";

import { authedFetch } from "@/hooks/use-authed-fetch";
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

interface TickerData {
  items: TickerItem[];
  generatedAt: string;
  softError?: string;
}

const CATEGORY_COLORS: Record<TickerItem["category"], string> = {
  market:   "text-emerald-400/80",
  macro:    "text-blue-400/80",
  industry: "text-amber-400/80",
  local:    "text-violet-400/70",
  timeline: "text-[var(--gold)]",  // default — overridden by severity below
  mode:     "text-[var(--text-primary)]",
  shop:     "text-[var(--gold)]/90", // oversight from nickstire — gold to signal "your stuff"
  brain:    "text-violet-400",       // self-model signal
};

const MODE_COLORS: Record<UltronMode, string> = {
  BATTLE:   "text-red-400",
  SURGICAL: "text-[var(--gold)]",
  RECOVERY: "text-amber-400",
  SHUTDOWN: "text-blue-400",
  NORMAL:   "text-[var(--text-tertiary)]",
};

const TIMELINE_SEVERITY: Record<NonNullable<TickerItem["severity"]>, string> = {
  warn: "text-amber-400",
  info: "text-[var(--gold)]/90",
  win:  "text-emerald-400",
};

interface TickerProps {
  mode?: UltronMode;
  reason?: string;
}

export function Ticker({ mode, reason }: TickerProps = {}) {
  const [data, setData] = useState<TickerData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await authedFetch("/api/ultron/ticker");
        if (!res.ok) return;
        const raw = (await res.json()) as { data?: TickerData };
        if (!alive) return;
        if (raw?.data) setData(raw.data);
      } catch {
        // silent — the ticker is ambient, not critical
      }
    };
    load();
    const iv = setInterval(load, 300_000); // 5 min
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // May 02 · per-item dismissal. localStorage-backed Set; X button on
  // each cell adds to it. STATIC_MACRO fallbacks (Apr 19 hardcoded
  // headlines) are common dismissal candidates — Nour can clear them
  // out and the marquee shrinks to live items only.
  const { dismissed, dismiss } = useDismissedTicker();

  // Prepend a MODE item only when mode is non-NORMAL. Gives the pill
  // a home in the ticker without hijacking the header row.
  const items: TickerItem[] = (() => {
    const base = data?.items ?? [];
    if (!mode || mode === "NORMAL") return base;
    const modeItem: TickerItem = {
      id: `mode-${mode}`,
      category: "mode",
      symbol: mode,
      label: reason ?? mode.toLowerCase(),
    };
    return [modeItem, ...base];
  })().filter((it) => !dismissed.has(it.id));

  if (items.length === 0) {
    return (
      <div className="min-h-[32px] sm:h-5 overflow-hidden border-b border-[var(--border-default)] bg-[var(--bg-void)]/60" aria-hidden />
    );
  }

  return (
    // v10.0.528 · a11y A3 fix · mobile bumped to min-h-[32px] (was h-5
    // = 20px) so tickers reach a tappable height per Apple HIG; desktop
    // stays compact at sm:h-5 since precision-pointer touch isn't the
    // constraint and density matters for the macro/market info-flow.
    <div className="min-h-[32px] sm:h-5 overflow-hidden border-b border-[var(--border-default)] bg-[var(--bg-void)]/60 relative group/ticker">
      <div className="ultron-ticker-track flex items-center gap-6 whitespace-nowrap py-0.5 absolute inset-0">
        {[...items, ...items].map((item, i) => (
          <TickerCell
            key={`${item.id}-${i}`}
            item={item}
            onDismiss={(id) => dismiss(id, { kind: item.category, source: "top" })}
          />
        ))}
      </div>
      <style jsx>{`
        .ultron-ticker-track {
          animation: ultron-ticker 55s linear infinite;
          will-change: transform;
        }
        @keyframes ultron-ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ultron-ticker-track:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}

function TickerCell({ item, onDismiss }: { item: TickerItem; onDismiss?: (id: string) => void }) {
  const deltaColor =
    item.deltaPct === undefined || item.deltaPct === null
      ? ""
      : item.deltaPct > 0
        ? "text-emerald-400"
        : item.deltaPct < 0
          ? "text-red-400"
          : "text-[var(--text-tertiary)]";

  // Timeline + shop items get severity-based coloring so urgent shop
  // alerts read differently than routine ones. Shop uses the same
  // amber/gold/emerald scheme as timeline to keep the eye anchored.
  const isTimeline = item.category === "timeline";
  const isMode = item.category === "mode";
  const isShop = item.category === "shop";
  const isBrain = item.category === "brain";
  const timelineColor =
    isTimeline && item.severity ? TIMELINE_SEVERITY[item.severity] : CATEGORY_COLORS.timeline;
  const shopColor =
    isShop && item.severity ? TIMELINE_SEVERITY[item.severity] : CATEGORY_COLORS.shop;
  const brainColor =
    isBrain && item.severity ? TIMELINE_SEVERITY[item.severity] : CATEGORY_COLORS.brain;

  // Mode items use the per-mode color (red/gold/amber/blue)
  const modeColor =
    isMode && item.symbol && (item.symbol as UltronMode) in MODE_COLORS
      ? MODE_COLORS[item.symbol as UltronMode]
      : CATEGORY_COLORS.mode;

  const baseColor = isTimeline
    ? timelineColor
    : isShop
      ? shopColor
      : isMode
        ? modeColor
        : isBrain
          ? brainColor
          : CATEGORY_COLORS[item.category];

  const content = (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-mono", baseColor)}>
      {isTimeline && <span className="opacity-70">◆</span>}
      {isShop && <span className="opacity-80">●</span>}
      {isMode && <span className="opacity-80">▲</span>}
      {isBrain && <span className="opacity-90">◉</span>}
      {item.symbol && (
        <span className={cn(
          "font-bold uppercase tracking-wider",
          isTimeline && "text-[9px] tracking-[0.2em]",
          isMode && "text-[9px] tracking-[0.22em]",
        )}>
          {item.symbol}
        </span>
      )}
      <span className={cn(
        item.symbol ? "text-[var(--text-secondary)]" : "",
        isMode && "italic",
      )}>
        {item.label.replace(new RegExp(`^${item.symbol}\\s*`), "")}
      </span>
      {item.deltaPct !== undefined && item.deltaPct !== null && (
        <span className={cn("tabular-nums", deltaColor)}>
          {item.deltaPct > 0 ? "▲" : item.deltaPct < 0 ? "▼" : "·"}
          {Math.abs(item.deltaPct).toFixed(1)}%
        </span>
      )}
    </span>
  );

  // May 02 · X button only mounts when an onDismiss handler is wired.
  // Renders inside a hover-revealed wrapper so the marquee stays clean
  // when nothing's hovered. Click stops propagation so it never trips
  // the parent <a> nav.
  const dismissBtn = onDismiss ? (
    <DismissButton
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onDismiss(item.id);
      }}
      label="Dismiss ticker item"
      hoverGate="cell"
      size="sm"
      className="hover:text-rose-400"
    />
  ) : null;

  if (item.href) {
    return (
      <span className="inline-flex items-center group/cell">
        <a
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:brightness-150 transition-all"
        >
          {content}
        </a>
        {dismissBtn}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center group/cell">
      {content}
      {dismissBtn}
    </span>
  );
}
