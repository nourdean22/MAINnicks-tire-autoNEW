"use client";

/**
 * components/settings/ticker-dismissal-card.tsx
 *
 * Extracted VERBATIM from app/(mastery)/settings/page.tsx (2026-06-02 ·
 * settings-shell redesign) · same behavior.
 *
 * May 02 · The ticker lets Nour X-out individual items (acknowledge +
 * hide). Only the bottom ticker remains — GlobalTopTicker was deleted
 * 2026-09-01 — so the copy names one ticker (settings census 2026-10-02). This panel surfaces the count of dismissed
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
              No items dismissed yet. Tap × on any item in the bottom ticker to acknowledge it (hides it on this device across reloads).
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
            <span className="text-fg font-mono">{count}</span> ticker item{count === 1 ? "" : "s"} acknowledged + hidden across reloads.
          </p>
          <p className="text-[12px] text-fg-tertiary mt-1.5">
            Resetting brings them back so the marquee surfaces them again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            clearAll();
          }}
          className="shrink-0 inline-flex items-center rounded-control border border-edge-default bg-content px-3 py-2 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
        >
          Reset
        </button>
      </div>
    </GlassCard>
  );
}
