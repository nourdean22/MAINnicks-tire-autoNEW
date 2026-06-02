"use client";

/**
 * components/settings/ticker-dismissal-card.tsx
 *
 * Extracted VERBATIM from app/(mastery)/settings/page.tsx (2026-06-02 ·
 * settings-shell redesign) · same behavior.
 *
 * May 02 · Both tickers (top + bottom) let Nour X-out individual items
 * (acknowledge + hide). This panel surfaces the count of dismissed
 * IDs from localStorage and exposes a one-tap reset for when a stale
 * dismissal is masking a now-relevant signal.
 */

import { GlassCard } from "@/components/ui/glass-card";
import { useDismissedTicker } from "@/hooks/use-dismissed-ticker";

export function TickerDismissalReset() {
  const { dismissed, clearAll } = useDismissedTicker();
  const count = dismissed.size;

  if (count === 0) {
    return (
      <GlassCard>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="section-label mb-1">ticker dismissals</p>
            <p className="text-[11px] text-[var(--text-secondary)]">
              No items dismissed yet. Hover any cell on the top or bottom ticker → tap × to acknowledge it (hides it across reloads).
            </p>
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="section-label mb-1">Ticker dismissals</p>
          <p className="text-[11px] text-[var(--text-secondary)]">
            <span className="text-[var(--gold)] font-mono">{count}</span> ticker item{count === 1 ? "" : "s"} acknowledged + hidden across reloads.
          </p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5">
            Resetting brings them back so the marquee surfaces them again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            clearAll();
          }}
          className="shrink-0 rounded-md border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-zinc-800/80 hover:text-[var(--text-primary)] transition-colors"
        >
          reset
        </button>
      </div>
    </GlassCard>
  );
}
