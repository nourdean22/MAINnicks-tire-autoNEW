"use client";

/**
 * HQStatusChips — compact control-surface chips for the HQ header.
 *
 * Surfaces the chat control state OUTSIDE of /chat so Nour can:
 *   • See pinned count at a glance (click → /brain#pinned-context)
 *   • See /api/ai/chat/suggestions health (click → /brain for
 *     SuggestionTelemetryPanel)
 *   • See system-prompt size + cache status (click → prompt inspector)
 *
 * Each chip is optional — hides when data is unavailable. Numbers
 * auto-refresh every 30s. Clicking deep-links into the right surface
 * with proper scroll anchor.
 *
 * Lives inside TopStrip between the wordmark and OmniCapture when
 * there's room. Mobile (< md) shows pin count only to save space.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Pin, Sparkles, AlertCircle } from "lucide-react";

import { authedFetch } from "@/hooks/use-authed-fetch";
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

export function HQStatusChips() {
  const [pins, setPins] = useState<PinSummary | null>(null);
  const [sug, setSug] = useState<SuggestionHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [pinsRes, sugRes] = await Promise.all([
          authedFetch("/api/brain/pinned?withStats=1").then((r) => (r.ok ? r.json() : null)),
          authedFetch("/api/ai/chat/suggestions/stats").then((r) => (r.ok ? r.json() : null)),
        ]);
        if (cancelled) return;
        if (pinsRes?.stats) {
          setPins({
            count: pinsRes.pins?.length ?? 0,
            staleCount: pinsRes.stats.stalePins ?? 0,
            veryStaleCount: pinsRes.stats.veryStalePins ?? 0,
            injectedCount: pinsRes.stats.injectedCount ?? 0,
          });
        }
        if (sugRes && typeof sugRes.cacheHitRate === "number") {
          setSug({
            hitRatePct: Math.round(sugRes.cacheHitRate * 100),
            fallbackHeavy:
              sugRes.heuristic > 0 &&
              sugRes.requests > 0 &&
              sugRes.heuristic / sugRes.requests > 0.4,
          });
        }
      } catch {
        // silent — chips are optional
      }
    }
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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
              : "border-zinc-700/40 bg-zinc-900/40 text-[var(--text-tertiary)] hover:border-[var(--gold)]/30 hover:text-[var(--gold)]/80"
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
