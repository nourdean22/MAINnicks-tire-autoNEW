"use client";

/**
 * BOTTOM PULSE TICKER — Nour's personal state, scrolling.
 *
 * Mirrors the top ticker's CSS marquee but scoped to YOU rather than
 * the external world. Rotates through:
 *   📝 latest capture          ⚔ MIT today
 *   🌙 tomorrow note focus     ◆ narrator observation
 *   ⚖ overdue commitments     👁 reflection freshness
 *   🏆 most recent win         👁 "Nick noticed today" (brain_insight)
 *   ⚙︎ watcher system signals
 *
 * Silent when nothing's notable — strip disappears so it doesn't take
 * space on a clean day. Color tone adapts per item (warn/win/info/mute).
 *
 * Data source: /api/ultron/personal-pulse (cached 90s). Polls every
 * 5 minutes. Hover pauses scroll.
 *
 * Replaces the old TodaysCaptures card that used to sit in TodayZone —
 * content moved here so HQ real estate stays focused on WorkDesk +
 * Ask + Signal while ambient personal signal flows at the bottom.
 *
 * v10.0.528 · a11y A6 fix · wrapped in role="region" + aria-label=
 * "System pulse" + aria-live="off" so screen-reader users can find/
 * skip the strip. We don't want each rotation announced — the strip
 * is ambient, not assertive.
 */

import { cn } from "@/lib/utils";

import { trpc } from "@/lib/trpc/client";
import { useDismissedTicker } from "@/hooks/use-dismissed-ticker";
import { DismissButton } from "@/components/ui/dismiss-button";
// v10.0.104 audit fix · keep this union in sync with the server's
// PulseItem.kind in app/api/ultron/personal-pulse/route.ts.
// Pre-fix the client type was frozen at the original 9 kinds while
// the API had been silently sending "contradiction" / "mind" / "life" /
// "wisdom" — the renderer doesn't switch on `kind` so unknown values
// passed through silently, but type drift meant any future kind-aware
// branch would fall through invisibly.
interface PulseItem {
  id: string;
  kind:
    | "capture" | "mit" | "tomorrow" | "narrator" | "commitment" | "reflection"
    | "win" | "insight" | "idle"
    | "contradiction" | "mind" | "life" | "wisdom";
  glyph: string;
  label: string;
  text: string;
  tone: "info" | "warn" | "win" | "mute";
  href?: string;
}

const TONE_COLORS: Record<PulseItem["tone"], string> = {
  info: "text-[var(--text-secondary)]",
  warn: "text-amber-400",
  win:  "text-emerald-400",
  mute: "text-[var(--text-tertiary)]",
};

const LABEL_COLORS: Record<PulseItem["tone"], string> = {
  info: "text-[var(--gold)]/80",
  warn: "text-amber-400",
  win:  "text-emerald-400",
  mute: "text-[var(--text-tertiary)]",
};

export function BottomPulseTicker() {
  // Phase B.6a (2026-05-22) · migrated off `authedFetch` onto
  // `trpc.operator.personalPulse`. React Query's refetchInterval
  // replaces the manual setInterval (5-min cadence preserved) · the
  // query is silent on failure (the ticker is ambient) so no error
  // branch is wired. `data` is the PulseData payload directly — the
  // procedure returns it unwrapped (the legacy `data` envelope gone).
  const { data } = trpc.operator.personalPulse.useQuery(undefined, {
    refetchInterval: 300_000,
    retry: false,
  });

  // May 02 · per-item dismissal — same shared hook as top ticker.
  const { dismissed, dismiss } = useDismissedTicker();
  const visibleItems = (data?.items ?? []).filter((it) => !dismissed.has(it.id));

  if (!data || visibleItems.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="System pulse"
      aria-live="off"
      className="min-h-[32px] sm:h-5 overflow-hidden border-t border-[var(--border-default)] bg-[var(--bg-void)]/60 relative"
    >
      <div className="ultron-bottom-ticker-track flex items-center gap-8 whitespace-nowrap py-0.5 absolute inset-0">
        {/* Duplicate the items once inline so the scroll seam is invisible */}
        {[...visibleItems, ...visibleItems].map((item, i) => (
          <PulseCell
            key={`${item.id}-${i}`}
            item={item}
            onDismiss={(id) => dismiss(id, { kind: item.kind, source: "bottom" })}
          />
        ))}
      </div>
      <style jsx>{`
        .ultron-bottom-ticker-track {
          animation: ultron-bottom-ticker 60s linear infinite;
          will-change: transform;
        }
        @keyframes ultron-bottom-ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ultron-bottom-ticker-track:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}

function PulseCell({ item, onDismiss }: { item: PulseItem; onDismiss?: (id: string) => void }) {
  const content = (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono">
      <span className="opacity-90">{item.glyph}</span>
      <span
        className={cn(
          "font-[var(--font-display)] font-bold uppercase tracking-[0.2em] text-[9px]",
          LABEL_COLORS[item.tone],
        )}
      >
        {item.label}
      </span>
      <span className={TONE_COLORS[item.tone]}>{item.text}</span>
    </span>
  );

  // May 02 · X dismissal — same pattern as the top ticker. Hover to
  // reveal, click stops propagation so it doesn't trip the parent <a>.
  // v10.0.529.95 · Wave 39 · M4 · alwaysVisible · pre-Wave-39 the X
  // was hover-only (DismissButton hoverGate="cell") which iOS Safari
  // gets via long-press only. Ticker is fixed bottom on every page · a
  // mobile-heavy operator couldn't dismiss noise without a second
  // intentional tap. Always-on costs ~12px visual weight per chip
  // on desktop · acceptable tradeoff for touch usability.
  const dismissBtn = onDismiss ? (
    <DismissButton
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onDismiss(item.id);
      }}
      label="Dismiss ticker item"
      alwaysVisible
      size="sm"
      className="hover:text-rose-400"
    />
  ) : null;

  if (item.href) {
    return (
      <span className="inline-flex items-center group/cell">
        <a
          href={item.href}
          className="hover:brightness-150 transition-all"
          aria-label={`${item.label}: ${item.text}`}
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
