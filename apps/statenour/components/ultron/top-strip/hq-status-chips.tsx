"use client";

/**
 * HQStatusChips — compact control-surface chips for the HQ header.
 *
 * Surfaces the chat control state OUTSIDE of /chat so Nour can:
 *   • See pinned count at a glance (click → /brain#pinned-context)
 *   • See chat-suggestion cache health (click → /brain for
 *     SuggestionTelemetryPanel)
 *   • See system-prompt size + cache status (click → prompt inspector)
 *
 * Each chip is optional — hides when data is unavailable. Numbers
 * auto-refresh every 30s. Clicking deep-links into the right surface
 * with proper scroll anchor.
 *
 * Lives inside TopStrip between the wordmark and OmniCapture when
 * there's room. Mobile (< md) shows pin count only to save space.
 *
 * Cross-domain residuals slice (2026-05-22) · migrated off the
 * `Promise.all([authedFetch ×2])` (/api/brain/pinned · /api/ai/chat/
 * suggestions/stats) onto `trpc.brain.pinned` + `trpc.brain.suggestionStats`
 * — two `useQuery` hooks with a 30s `refetchInterval` (a `Promise.all`
 * of `utils.*.fetch()` would trip TS2589 via tuple inference · two
 * independent reactive queries is the correct shape anyway). The
 * `brain.pinned` procedure types its result as `Record<string,unknown>`
 * so the two fields this chip reads are narrowed at the call-site.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Pin, Sparkles, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

interface PinSummary {
  count: number;
  staleCount: number;
  veryStaleCount: number;
  injectedCount: number;
}

interface SuggestionHealth {
  hitRatePct: number;
  fallbackHeavy: boolean;
}

/** Narrow the `brain.pinned` loose `Record` result to what this chip reads. */
function readPinSummary(raw: Record<string, unknown> | undefined): PinSummary | null {
  if (!raw) return null;
  const stats = raw.stats as
    | {
        stalePins?: number;
        veryStalePins?: number;
        injectedCount?: number;
      }
    | undefined;
  if (!stats) return null;
  const pins = Array.isArray(raw.pins) ? raw.pins : [];
  return {
    count: pins.length,
    staleCount: stats.stalePins ?? 0,
    veryStaleCount: stats.veryStalePins ?? 0,
    injectedCount: stats.injectedCount ?? 0,
  };
}

export function HQStatusChips() {
  const pinnedQuery = trpc.brain.pinned.useQuery(
    { withStats: true },
    { refetchInterval: 30_000, refetchOnWindowFocus: false },
  );
  const sugQuery = trpc.brain.suggestionStats.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const pins = readPinSummary(pinnedQuery.data);
  const sugData = sugQuery.data;
  const sug: SuggestionHealth | null = sugData
    ? {
        hitRatePct: Math.round(sugData.cacheHitRate * 100),
        fallbackHeavy:
          sugData.heuristic > 0 &&
          sugData.requests > 0 &&
          sugData.heuristic / sugData.requests > 0.4,
      }
    : null;

  if (!pins && !sug) return null;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {pins && pins.count > 0 && (
        <Link
          href="/brain#pinned-context"
          className={cn(
            "group flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-[0.14em] transition-all",
            "border-[var(--gold)]/30 bg-[var(--gold)]/[0.05] text-[var(--gold)]/90",
            "hover:border-[var(--gold)]/50 hover:bg-[var(--gold)]/[0.12]",
            pins.veryStaleCount > 0 &&
              "border-red-500/40 bg-red-500/[0.05] text-red-400 hover:bg-red-500/[0.12]",
            pins.veryStaleCount === 0 &&
              pins.staleCount > 0 &&
              "border-amber-500/40 bg-amber-500/[0.05] text-amber-400 hover:bg-amber-500/[0.12]"
          )}
          title={`${pins.count} pinned · ${pins.injectedCount}/5 in prompt${
            pins.staleCount ? ` · ${pins.staleCount} stale` : ""
          }${pins.veryStaleCount ? ` · ${pins.veryStaleCount} very stale` : ""}`}
        >
          <Pin size={9} />
          <span>{pins.count}</span>
          {pins.veryStaleCount > 0 && (
            <AlertCircle size={8} className="text-red-400" />
          )}
        </Link>
      )}
      {sug && (
        <Link
          href="/brain"
          className={cn(
            "hidden md:flex group items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-[0.14em] transition-all",
            sug.fallbackHeavy
              ? "border-amber-500/30 bg-amber-500/[0.05] text-amber-400 hover:bg-amber-500/[0.12]"
              : "border-[var(--border-hover)]/40 bg-[var(--bg-elevated)]/40 text-[var(--text-tertiary)] hover:border-[var(--gold)]/30 hover:text-[var(--gold)]/80"
          )}
          title={`Suggestion cache hit rate: ${sug.hitRatePct}%${
            sug.fallbackHeavy ? " · heuristic-heavy (Venice slow?)" : ""
          }`}
        >
          <Sparkles size={9} />
          <span>{sug.hitRatePct}%</span>
        </Link>
      )}
    </div>
  );
}
