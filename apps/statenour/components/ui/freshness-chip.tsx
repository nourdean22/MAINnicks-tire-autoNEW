"use client";

/**
 * <FreshnessChip /> — "Nns ago · source: X" chip that lives in the
 * corner of every data card.
 *
 * v11.1 power-panel principle: every data surface shows (a) how
 * fresh the data is and (b) where it came from. No more wondering
 * "is this live or was this cached 2 hours ago?" Every panel gets
 * the same treatment — identical language, identical position,
 * identical colors.
 *
 * Color tiers by age:
 *   <60s    → emerald (live)
 *   <5min   → gold (fresh)
 *   <1h     → text-secondary (recent)
 *   <1d     → amber (stale)
 *   >=1d    → rose (very stale)
 *
 * Self-ticking: re-renders every 30s so "45s ago" becomes "1m ago"
 * without a parent re-render. Quiet animation — subtle dot pulse
 * only while status is "live." Tap the chip to force a parent
 * reload (if onReload provided).
 *
 * Usage:
 *   <GlassCard>
 *     <FreshnessChip lastFetchedAt={pulse.generatedAt} source="cache" onReload={pulse.reload} />
 *     <YourContent />
 *   </GlassCard>
 */

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

// ─── Shared 30s ticker · v10.0.457 ─────────────────────────────────
//
// Motion+a11y audit Finding M1 · before this refactor, every
// FreshnessChip instance ran its own `setInterval(30_000)` timer.
// On pages that render many data cards (e.g. /knowledge with 50+
// files, each wrapped in a card with a chip) that became 50
// concurrent timers, each waking the JS engine independently. On
// iOS this is non-trivial when stacked with other timers across
// the OS.
//
// Now: single module-level interval started lazily on the first
// subscribe and stopped when the last subscriber unmounts. All
// FreshnessChip instances share the same `now` snapshot via
// `useSyncExternalStore` (React 18 official pattern · SSR-safe ·
// concurrent-mode safe).

let sharedNow = Date.now();
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function startTickerIfNeeded(): void {
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    sharedNow = Date.now();
    // Notify every subscribed FreshnessChip · React batches the
    // resulting re-renders inside a single concurrent slot.
    for (const fn of listeners) fn();
  }, 30_000);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  startTickerIfNeeded();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot(): number {
  return sharedNow;
}

function getServerSnapshot(): number {
  // SSR · use a stable value so server + first-client render match.
  // The actual age recalculates after hydration when the real now
  // arrives.
  return 0;
}

interface FreshnessChipProps {
  /** When was the data fetched? ISO string or Date. null/undefined → "no data" chip. */
  lastFetchedAt: string | number | Date | null | undefined;
  /** Source label — e.g. "cache", "db", "nickstire", "venice". Shown after the `·`. */
  source?: string;
  /** Optional reload handler. When provided, the chip becomes tappable. */
  onReload?: () => void;
  /** Compact mode drops the source label (just shows age). */
  compact?: boolean;
  className?: string;
}

function fmtAge(ms: number): { text: string; tone: "live" | "fresh" | "recent" | "stale" | "very-stale" } {
  if (ms < 0) return { text: "just now", tone: "live" };
  if (ms < 60_000) return { text: `${Math.floor(ms / 1000)}s ago`, tone: "live" };
  if (ms < 5 * 60_000) return { text: `${Math.floor(ms / 60_000)}m ago`, tone: "fresh" };
  if (ms < 60 * 60_000) return { text: `${Math.floor(ms / 60_000)}m ago`, tone: "recent" };
  if (ms < 24 * 60 * 60_000) return { text: `${Math.floor(ms / (60 * 60_000))}h ago`, tone: "stale" };
  return { text: `${Math.floor(ms / (24 * 60 * 60_000))}d ago`, tone: "very-stale" };
}

const TONE_STYLES: Record<string, { text: string; dot: string; bg: string }> = {
  live: { text: "text-emerald-400", dot: "bg-emerald-400 animate-pulse", bg: "bg-emerald-500/5 border-emerald-500/20" },
  fresh: { text: "text-[var(--gold)]", dot: "bg-[var(--gold)]", bg: "bg-[var(--gold)]/5 border-[var(--gold)]/20" },
  recent: { text: "text-[var(--text-secondary)]", dot: "bg-[var(--text-secondary)]", bg: "bg-transparent border-[var(--border-default)]" },
  stale: { text: "text-amber-400", dot: "bg-amber-400", bg: "bg-amber-500/5 border-amber-500/25" },
  "very-stale": { text: "text-rose-400", dot: "bg-rose-400", bg: "bg-rose-500/5 border-rose-500/30" },
};

export function FreshnessChip({ lastFetchedAt, source, onReload, compact, className }: FreshnessChipProps) {
  // v10.0.457 · subscribe to the shared 30s tick source instead of
  // running a per-instance setInterval. See module-level comment
  // above for rationale. SSR returns 0 → first-client hydration
  // re-runs with the real `now`.
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (lastFetchedAt == null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-mono",
          "border-[var(--border-default)] text-[var(--text-tertiary)]",
          className,
        )}
      >
        <span className="w-1 h-1 rounded-full bg-[var(--text-tertiary)]" />
        no data
      </span>
    );
  }

  const ts = typeof lastFetchedAt === "string" || typeof lastFetchedAt === "number"
    ? new Date(lastFetchedAt).getTime()
    : lastFetchedAt.getTime();
  const ageMs = now - ts;
  const { text, tone } = fmtAge(ageMs);
  const styles = TONE_STYLES[tone];

  const content = (
    <>
      <span className={cn("w-1 h-1 rounded-full shrink-0", styles.dot)} />
      <span className={cn("tabular-nums", styles.text)}>{text}</span>
      {!compact && source && (
        <>
          <span className="text-[var(--text-tertiary)]/40">·</span>
          <span className="text-[var(--text-tertiary)] lowercase">{source}</span>
        </>
      )}
      {onReload && (
        <RefreshCw size={8} className="text-[var(--text-tertiary)] ml-0.5 opacity-60 group-hover:opacity-100 transition-opacity" />
      )}
    </>
  );

  const className_ = cn(
    "group inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-mono transition-colors",
    styles.bg,
    className,
  );

  if (onReload) {
    return (
      <button
        type="button"
        onClick={onReload}
        className={cn(className_, "hover:border-[var(--gold)]/40 cursor-pointer")}
        title={`Last refresh · tap to reload`}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={className_} title="Last refresh">
      {content}
    </span>
  );
}
