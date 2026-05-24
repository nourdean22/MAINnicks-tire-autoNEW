"use client";

/**
 * PricingAdvisoryCard · Wave X.f (2026-05-24) · activation.
 *
 * Surfaces the weekly pricing advisory the `pricing-advisor` Sunday
 * cron writes to `BrainMemory(category="pricing_advisory", key="weekly_...")`.
 * Pre-fix the operator could only see this via a chat tool — they
 * had to KNOW to ask Nick about pricing. Now the Sunday computation
 * becomes a visible card on /scoreboard every time the operator
 * opens it: which service categories are below fleet median, what
 * the competitor signal says, and the 3 drafted price experiments
 * awaiting approval.
 *
 * Reads · `GET /api/system/pricing-advisory`. Silent-hides on no
 * advisory yet (the cron hasn't run · clean Sunday-morning empty
 * state is silence, not a placeholder card).
 */

import { useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";

interface OutlierCategory {
  category: string;
  winRate: number;
  fleetMedian: number;
  gap: number;
}

interface AdvisorySnapshot {
  headline: string;
  fleetMedianWinRate: number;
  outliers: OutlierCategory[];
  experimentsByCategory?: Record<string, Array<{
    hypothesis: string;
    variant: string;
  }>>;
}

interface AdvisoryResponse {
  hasAdvisory: boolean;
  generatedAt?: string;
  date?: string;
  headline?: string;
  snapshot?: AdvisorySnapshot | null;
}

export function PricingAdvisoryCard() {
  const [data, setData] = useState<AdvisoryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/system/pricing-advisory", {
          credentials: "include",
        });
        if (!res.ok) {
          if (!cancelled) setData({ hasAdvisory: false });
          return;
        }
        const json = (await res.json()) as AdvisoryResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ hasAdvisory: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Silent-when-empty · no advisory written yet OR fetch failed.
  if (!data || !data.hasAdvisory) return null;

  const snapshot = data.snapshot;
  const outliers = snapshot?.outliers ?? [];
  const topExperiments = snapshot?.experimentsByCategory
    ? Object.values(snapshot.experimentsByCategory).flat().slice(0, 3)
    : [];

  return (
    <GlassCard className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            pricing advisory
          </div>
          {data.date && (
            <div className="text-[9px] text-[var(--text-tertiary)] mt-0.5 tabular-nums">
              week of {data.date}
            </div>
          )}
        </div>
        {typeof snapshot?.fleetMedianWinRate === "number" && (
          <div className="text-[10px] tabular-nums text-[var(--text-tertiary)]">
            fleet {Math.round(snapshot.fleetMedianWinRate * 100)}%
          </div>
        )}
      </div>

      {data.headline && (
        <p className="text-[12px] text-[var(--text-primary)] leading-relaxed">
          {data.headline}
        </p>
      )}

      {outliers.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            below median ({outliers.length})
          </div>
          <ul className="space-y-1">
            {outliers.slice(0, 4).map((o) => (
              <li
                key={o.category}
                className="flex items-baseline justify-between text-[11px] font-mono"
              >
                <span className="text-[var(--text-secondary)] truncate">
                  {o.category}
                </span>
                <span className="text-amber-400 tabular-nums shrink-0 ml-2">
                  −{Math.round(o.gap * 100)}pts
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topExperiments.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            drafted experiments
          </div>
          <ul className="space-y-1">
            {topExperiments.map((exp, i) => (
              <li
                key={i}
                className="text-[11px] text-[var(--text-secondary)] line-clamp-2"
              >
                <span className="text-[var(--gold)]">·</span> {exp.hypothesis}
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}
