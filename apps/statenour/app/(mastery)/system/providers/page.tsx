"use client";

/**
 * /system/providers · live provider-health dashboard.
 *
 * The dense companion to <ProviderDegradationBanner/>. The banner is a
 * single-line alert that only renders when something is wrong; this page
 * is the *always-on* table — every provider × every health column,
 * scannable per-column tinting via <ComparisonMatrix>.
 *
 * This is the SECOND consumer of <ComparisonMatrix> (the first is
 * /decisions/[id] · siblings × grade/age/review/outcome). Proving the
 * primitive's reusability for an operator dashboard rather than a
 * decision-detail view was the explicit goal of this slice.
 *
 * Cadence: 60s · matches the banner. React Query's `refetchInterval`
 * drives the poll · `refetchOnWindowFocus: false` so jumping tabs doesn't
 * spam the breaker checks. Read-only · no provider call is auto-triggered
 * by mounting this page.
 *
 * Columns (locked per the agent brief):
 *   1. status  · online / down  · higherIsBetter via score (1/0)
 *   2. latency (ms) · lower wins · higherIsBetter: false
 *   3. recent errors · lower wins
 *   4. quota cooldown (s) · lower wins
 *   5. tier  · informational (no tinting · no score)
 *
 * The derivation from ProviderHealthSnapshot → matrix props lives in a
 * pure helper `derive-provider-matrix.ts` so it's unit-testable without
 * rendering the page through a tRPC provider in jsdom.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { trpc } from "@/lib/trpc/client";
import { ComparisonMatrix } from "@/components/ui/comparison-matrix";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { cn } from "@/lib/utils";

import {
  PROVIDER_MATRIX_CRITERIA,
  buildProviderMatrixOptions,
  resolveProviderMatrixCell,
} from "./derive-provider-matrix";

const POLL_MS = 60_000;

const TONE_PILL: Record<"green" | "amber" | "red", string> = {
  green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  red: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

export default function SystemProvidersPage() {
  const query = trpc.system.providerHealth.useQuery(undefined, {
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const data = query.data;
  const isLoading = query.isLoading;
  const error = query.error;

  // ── Loading shell · matches /system/health pattern ────────────────
  if (isLoading && !data) {
    return (
      <main className="mx-auto max-w-4xl space-y-4 px-3 py-4">
        <header className="flex items-center gap-2">
          <Link
            href="/system"
            className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
            aria-label="back to system"
          >
            <ChevronLeft size={16} />
          </Link>
          <h1 className="text-lg font-[var(--font-display)] font-bold lowercase tracking-[0.14em] text-[var(--text-primary)]">
            providers · live health
          </h1>
        </header>
        <ShimmerSkeleton className="h-10 rounded" />
        <ShimmerSkeleton className="h-48 rounded" />
      </main>
    );
  }

  // ── Error shell · keep the operator on the page; surface the message
  if (error && !data) {
    return (
      <main className="mx-auto max-w-4xl space-y-4 px-3 py-4">
        <header className="flex items-center gap-2">
          <Link
            href="/system"
            className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
            aria-label="back to system"
          >
            <ChevronLeft size={16} />
          </Link>
          <h1 className="text-lg font-[var(--font-display)] font-bold lowercase tracking-[0.14em] text-[var(--text-primary)]">
            providers · live health
          </h1>
        </header>
        <section className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3">
          <p className="text-[11px] font-mono text-rose-300">
            providerHealth unavailable · {error.message}
          </p>
        </section>
      </main>
    );
  }

  if (!data) return null;

  const options = buildProviderMatrixOptions(data);

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-3 py-4">
      {/* Header · back-link · title · freshness chip */}
      <header className="flex items-center gap-2">
        <Link
          href="/system"
          className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
          aria-label="back to system"
        >
          <ChevronLeft size={16} />
        </Link>
        <p className="eyebrow">NOUR OS · System</p>
        <h1 className="text-lg font-[var(--font-display)] font-bold lowercase tracking-[0.14em] text-[var(--text-primary)] ml-1">
          providers · live health
        </h1>
        <FreshnessChip
          lastFetchedAt={data.generatedAt}
          source="provider-health"
          onReload={() => void query.refetch()}
        />
      </header>

      {/* Overall-tone pill · mirrors the degradation banner so the
          operator gets the one-glance verdict before parsing the table. */}
      <section
        className={cn(
          "rounded-lg border px-3 py-2 text-[11px] font-medium tracking-wide",
          TONE_PILL[data.overallTone],
        )}
      >
        <span className="font-mono uppercase tracking-[0.2em] text-[10px] opacity-80 mr-2">
          system tone
        </span>
        <span className="font-bold">{data.pillLabel}</span>
        <span className="ml-3 text-[10px] font-mono opacity-70">
          {data.providers.filter((p) => p.available).length}/
          {data.providers.length} up
        </span>
      </section>

      {/* The matrix · the whole point of the page */}
      <ComparisonMatrix
        title="ai providers · per-column rank"
        caption="emerald = best in column · rose = worst · amber = middle band · cells refresh every 60s"
        options={options}
        criteria={PROVIDER_MATRIX_CRITERIA}
        cells={resolveProviderMatrixCell}
        defaultSortCriterion="status"
      />

      {/* Footnote · cadence + read-only contract */}
      <p className="text-[10px] font-mono text-[var(--text-tertiary)] leading-relaxed">
        polled every 60 seconds · read-only · this page does not trigger any
        provider call. latency + error counts cover the last hour from{" "}
        <span className="text-[var(--text-secondary)]">AiGeneration</span>{" "}
        telemetry · cooldown reflects the in-memory quota breaker.
      </p>
    </main>
  );
}
