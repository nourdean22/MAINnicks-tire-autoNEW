"use client";

/**
 * LocationRankingCard · Wave X.f (2026-05-24) · activation.
 *
 * Surfaces the monthly second-location feasibility ranking the
 * `monthly-location-rank` cron writes to
 * `BrainMemory(category="location_ranking", key="monthly_YYYY-MM")`.
 * Pre-fix the cron ran monthly + the API was live but no operator
 * surface rendered the output · the strategic-decision signal was
 * dark.
 *
 * Reads · `GET /api/business/location-ranking`. The endpoint
 * returns the persisted markdown `content` + a generic `metadata`
 * blob. This card renders the `content` (a human-readable summary
 * with the top-5 candidates) and the `updatedAt` so the operator
 * sees the data's freshness. Silent-hides when `found = false`
 * (no ranking computed yet for the current month).
 */

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/utils/api-fetch";
import { GlassCard } from "@/components/ui/glass-card";

interface LocationRanking {
  monthKey: string;
  found: boolean;
  content: string | null;
  updatedAt: string | null;
}

function formatStaleness(updatedAt: string | null): string {
  if (!updatedAt) return "";
  const days = Math.floor(
    (Date.now() - new Date(updatedAt).getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export function LocationRankingCard() {
  const [data, setData] = useState<LocationRanking | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // apiHandler-wrapped: res.json() was the envelope, so `found` was
        // undefined and this card read "not found" on every successful 200.
        const json = await apiFetch<LocationRanking>("/api/business/location-ranking");
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ monthKey: "", found: false, content: null, updatedAt: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Silent-when-empty · no ranking persisted for the current month
  // OR fetch failed. Cron runs 1st of ET month · gaps are normal.
  if (!data || !data.found || !data.content) return null;

  return (
    <GlassCard className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          second-location ranking
        </div>
        <div className="flex items-baseline gap-2 text-[9px] tabular-nums text-[var(--text-tertiary)]">
          <span>{data.monthKey}</span>
          {data.updatedAt && <span>· {formatStaleness(data.updatedAt)}</span>}
        </div>
      </div>
      {/* The persisted `content` is a markdown-shaped summary the cron
          composed. Rendered as preformatted text so newlines + indent
          structure are preserved without pulling in a markdown
          renderer. Operator-facing surface, not a public page. */}
      <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-secondary)] font-sans">
        {data.content}
      </pre>
    </GlassCard>
  );
}
