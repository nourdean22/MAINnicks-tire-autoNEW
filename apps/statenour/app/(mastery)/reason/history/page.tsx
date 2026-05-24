"use client";

/**
 * /reason/history · Phase H.3 (2026-05-18 PM) · Phase N.3 (2026-05-18 PM)
 *
 * N.3 · row virtualization · with the 500-row trace rotation cap (H.4.2),
 * rendering all rows synchronously caused measurable lag on mobile.
 * Now uses @tanstack/react-virtual to render only visible rows + a
 * small overscan buffer. Same behavior · much smoother scroll.
 *
 * Surfaces the persisted reasoning_trace rows · closes the loop
 * Phase H.2.2 opened (persistence was write-only until this page).
 *
 * Shows:
 *   · Daily budget bar · spent today / cap · drives the "is it safe
 *     to run another mega" decision
 *   · Run list · last 50 reasoning runs · tier · cost · latency ·
 *     question · answer snippet · "re-run" link
 *   · Tier distribution · what tiers the operator's been firing
 *
 * Aesthetic · editorial-minimalist · gold accent on the budget bar
 * + tier pills · matches the rest of the mastery surfaces.
 */

import { useRef } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
// Phase J · tRPC migration · history page now reads via trpc.nick.history ·
// types inferred from the router · no manual HistoryShape mirror.
import { trpc } from "@/lib/trpc/client";
import { MasteryErrorView } from "@/components/mastery/mastery-error-view";
import { MasterySkeleton } from "@/components/mastery/mastery-skeleton";

interface HistoryRow {
  id: string;
  question: string;
  answer: string;
  tier: string;
  classifierReason: string;
  totalMs: number;
  calls: number;
  usd: number;
  confidence: number;
  stepCount: number;
  stepKinds: string[];
  createdAt: string;
}

interface HistoryStats {
  totalRuns: number;
  totalSpendAllUsd: number;
  spentTodayUsd: number;
  dailyCapUsd: number;
  tierCounts: Record<string, number>;
}

interface HistoryShape {
  history: HistoryRow[];
  stats: HistoryStats;
  fetchedAt: string;
}

const TIER_TONE: Record<string, string> = {
  quick: "text-[var(--text-tertiary)]",
  standard: "text-sky-300",
  deep: "text-violet-300",
  thorough: "text-amber-300",
  mega: "text-[var(--gold)]",
};

export default function ReasoningHistoryPage() {
  const { data, error, isLoading, refetch } = trpc.nick.history.useQuery(
    { limit: 50 },
    { staleTime: 30_000 },
  );

  if (isLoading && !data) return <MasterySkeleton cards={4} maxWidth="max-w-3xl" />;
  if (error)
    return (
      <MasteryErrorView
        label="Reasoning history"
        error={error.message}
        onRetry={() => void refetch()}
      />
    );
  if (!data) return null;

  const { history, stats } = data;
  const budgetPct = Math.min(100, (stats.spentTodayUsd / stats.dailyCapUsd) * 100);
  const budgetTone =
    budgetPct >= 90 ? "bg-red-400" : budgetPct >= 60 ? "bg-amber-400" : "bg-emerald-400";

  return (
    <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        {/* Header */}
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] mb-1">
              Nick · reasoning
            </p>
            <h1 className="text-2xl font-medium text-[var(--text-primary)]">
              History
            </h1>
          </div>
          <Link
            href="/reason"
            className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-secondary)] hover:text-[var(--gold)] transition"
          >
            ← back to reason
          </Link>
        </header>

        {/* Daily budget bar */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.14em]">
            <span className="text-[var(--text-tertiary)]">today · spend</span>
            <span className="tabular-nums text-[var(--text-secondary)]">
              ${stats.spentTodayUsd.toFixed(3)} / ${stats.dailyCapUsd.toFixed(2)}
              <span className="ml-2 text-[var(--text-tertiary)]">{budgetPct.toFixed(0)}%</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${budgetTone}`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            resets midnight ET · all-time spend ${stats.totalSpendAllUsd.toFixed(3)} across {stats.totalRuns} run{stats.totalRuns === 1 ? "" : "s"}
          </p>
        </section>

        {/* Tier distribution */}
        {Object.keys(stats.tierCounts).length > 0 ? (
          <section className="flex flex-wrap items-center gap-2">
            {Object.entries(stats.tierCounts).map(([tier, count]) => (
              <span
                key={tier}
                className={`text-[10px] font-mono uppercase tracking-[0.14em] px-2 py-1 rounded-full border border-white/10 ${TIER_TONE[tier] ?? "text-[var(--text-tertiary)]"}`}
              >
                {tier} · {count}
              </span>
            ))}
          </section>
        ) : null}

        {/* History list · N.3 virtualized */}
        {history.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">
            No reasoning runs yet. <Link href="/reason" className="text-[var(--gold)] hover:underline">Ask Nick →</Link>
          </p>
        ) : (
          <VirtualHistoryList history={history} />
        )}
      </div>
    </main>
  );
}

// N.3 · virtualized row list · only renders visible rows + overscan.
// Estimated row height tuned to typical card (~180px with 2-line
// question + 3-line answer). The virtualizer auto-measures actual
// heights once mounted, so the estimate just affects the initial scroll.
function VirtualHistoryList({ history }: { history: HistoryRow[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- tanstack-virtual's useVirtualizer returns measure/getVirtualItems functions that React 19's strict checker can't analyze · library-side limitation · the hook is stable per the @tanstack/react-virtual contract
  const virtualizer = useVirtualizer({
    count: history.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 180,
    overscan: 6,
  });
  return (
    <div
      ref={parentRef}
      className="rounded-md border border-white/5"
      style={{ height: "70vh", maxHeight: "800px", overflow: "auto" }}
    >
      <ul
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const h = history[vRow.index];
          return (
            <li
              key={h.id}
              ref={virtualizer.measureElement}
              data-index={vRow.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vRow.start}px)`,
              }}
              className="px-3 pb-3"
            >
              <div className="rounded-md border border-white/10 bg-white/[0.02] p-4 space-y-2 hover:bg-white/[0.04] transition">
                <div className="flex items-baseline justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.14em]">
                  <span className={TIER_TONE[h.tier] ?? "text-[var(--text-tertiary)]"}>
                    {h.tier}
                  </span>
                  <span className="text-[var(--text-tertiary)] tabular-nums">
                    {(h.totalMs / 1000).toFixed(1)}s · {h.calls} call{h.calls === 1 ? "" : "s"} · ${h.usd.toFixed(3)} · {(h.confidence * 100).toFixed(0)}% conf
                  </span>
                </div>
                <p className="text-sm text-[var(--text-primary)] line-clamp-2">
                  {h.question}
                </p>
                {h.answer ? (
                  <p className="text-xs text-[var(--text-secondary)] line-clamp-3 italic">
                    {h.answer}
                  </p>
                ) : null}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    {new Date(h.createdAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })} · {h.stepCount} steps
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        sessionStorage.setItem("reason:pending-q", h.question);
                        window.location.href = "/reason?h=1";
                      } catch {
                        window.location.href = `/reason?q=${encodeURIComponent(h.question.slice(0, 80))}`;
                      }
                    }}
                    className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-secondary)] hover:text-[var(--gold)]"
                  >
                    re-run &rarr;
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
