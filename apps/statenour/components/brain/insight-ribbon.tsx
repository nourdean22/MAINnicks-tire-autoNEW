"use client";

/**
 * InsightRibbon · v10.0.218 · cross-system narrative strip.
 *
 * Renders at the top of /brain. Distinct from NudgePanel (which is
 * actionable now-deltas) — this is week-over-week pattern signal:
 *   "3 lessons logged · vs 1 prior · learning sprint"
 *   "captures category +47% · 38 → 56 · emerging theme"
 *   "11d since last reflection · usual cadence 4d · overdue"
 *
 * Aesthetic: editorial. Big number, tracked tiny-caps eyebrow,
 * supporting clause in dim secondary text. Asymmetric per-card —
 * the headline is the felt thing, supporting is the receipt.
 *
 * Auto-hides if no insights returned (clean week = no ribbon).
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

interface BrainInsight {
  kind: string;
  eyebrow: string;
  headline: string;
  supporting: string;
  metric: number;
  deltaPct?: number;
  severity: "info" | "warn" | "highlight";
  link?: string;
}

interface InsightPayload {
  generatedAt: string;
  insights: BrainInsight[];
}

const SEVERITY_TONE: Record<BrainInsight["severity"], string> = {
  info: "border-[var(--border-soft)] bg-[var(--bg-card)]",
  warn: "border-amber-500/30 bg-amber-500/[0.04]",
  highlight: "border-[var(--gold)]/35 bg-[var(--gold)]/[0.05]",
};

const HEADLINE_TONE: Record<BrainInsight["severity"], string> = {
  info: "text-[var(--text-primary)]",
  warn: "text-amber-300",
  highlight: "text-[var(--gold)]",
};

export function InsightRibbon() {
  // scattered-components REST→tRPC slice (2026-05-22) · migrated off
  // `useAuthedFetch<InsightPayload>("/api/brain/insights")` onto
  // `trpc.brain.insightsRibbon.useQuery()`. The procedure delegates to
  // the same `buildBrainInsights` service the REST route also calls.
  // `loading` ← `isLoading`. The ribbon auto-hides on any non-data
  // state so no error surface is needed (the legacy hook's
  // `retryOn401: false` just meant "don't bounce to sign-in" — React
  // Query already doesn't redirect).
  const { data, isLoading: loading } = trpc.brain.insightsRibbon.useQuery();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Hide on first paint to avoid layout flash; show only when data
  // has arrived AND there's something to say.
  if (!mounted || loading || !data || data.insights.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          this week
        </p>
        <p className="text-[9px] font-mono tracking-wider text-[var(--text-tertiary)]/70">
          {data.insights.length} pattern{data.insights.length === 1 ? "" : "s"}
        </p>
      </div>
      {/* v10.0.530 · de-slopped from sm:grid-cols-2 lg:grid-cols-3
          symmetric feature-card grid to a stacked feed. Display-font
          headlines (18-19px) reading side-by-side at 3-wide is the
          archetypal AI-design fingerprint. Stacked scan-down is the
          operator-grade editorial pattern · matches what we already
          did for brain-insights-panel (v10.0.486). */}
      <div className="space-y-2">
        {data.insights.map((insight, i) => (
          <InsightCard key={`${insight.kind}-${i}`} insight={insight} />
        ))}
      </div>
    </section>
  );
}

function InsightCard({ insight }: { insight: BrainInsight }) {
  const inner = (
    <article
      className={cn(
        "rounded-2xl border px-4 py-3 transition-colors h-full",
        SEVERITY_TONE[insight.severity],
        insight.link && "hover:border-[var(--gold)]/40",
      )}
    >
      <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-1">
        {insight.eyebrow}
      </p>
      <h3
        className={cn(
          "text-[18px] sm:text-[19px] font-[var(--font-display)] font-bold leading-tight tracking-tight",
          HEADLINE_TONE[insight.severity],
        )}
      >
        {insight.headline}
      </h3>
      <p className="mt-1 text-[11px] text-[var(--text-secondary)] leading-snug">
        {insight.supporting}
      </p>
    </article>
  );

  if (insight.link) {
    return (
      <a href={insight.link} className="block h-full">
        {inner}
      </a>
    );
  }
  return inner;
}
