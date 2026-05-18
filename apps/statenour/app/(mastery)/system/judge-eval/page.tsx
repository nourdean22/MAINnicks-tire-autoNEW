"use client";

/**
 * /system/judge-eval · Phase V (2026-05-18 PM)
 *
 * Parity dashboard for the AGENT_V1 → AGENT_V2 migration. Closes the
 * Phase 0 prerequisite the agent-v1-to-v2 doc has been blocking on:
 *
 *   > Phase 1 canary requirement · daily judge-eval comparator runs
 *   > · alerts on regression. 7-day observation window before promotion.
 *
 * Shows:
 *   · Verdict chip (safe / watch / regressing / insufficient-data)
 *   · 7d + 24h win-rate buckets (V2 wins · V1 wins · ties · pct)
 *   · Per-intent class breakdown (catches "V2 regresses on summarization
 *     but wins on Q&A" patterns)
 *   · 10 most recent comparison runs with prompt snippet + per-dim
 *     judgment + summary
 *
 * Run new comparisons via `POST /api/judge-eval/run` (Phase V.6) until
 * the daily cron is wired.
 */

import { useState } from "react";
import Link from "next/link";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Loader2,
  Scale,
  Eye,
  Sparkles,
} from "lucide-react";

type Winner = "v1" | "v2" | "tie";
type Verdict = "safe" | "watch" | "regressing" | "insufficient-data";

const VERDICT_TONE: Record<Verdict, string> = {
  safe: "border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-300",
  watch: "border-amber-500/30 bg-amber-500/[0.05] text-amber-300",
  regressing: "border-rose-500/40 bg-rose-500/[0.08] text-rose-300",
  "insufficient-data":
    "border-[var(--border-default)] bg-[var(--bg-base)]/40 text-[var(--text-secondary)]",
};

const WINNER_TONE: Record<Winner, string> = {
  v2: "bg-emerald-500/15 text-emerald-300",
  v1: "bg-rose-500/15 text-rose-300",
  tie: "bg-[var(--bg-void)] text-[var(--text-tertiary)]",
};

export default function JudgeEvalPage() {
  const utils = trpc.useUtils();
  const { data, isLoading, error, refetch } =
    trpc.system.judgeEvalSummary.useQuery(undefined, {
      refetchInterval: 60_000,
      staleTime: 30_000,
    });
  const samplesQ = trpc.system.judgeEvalSamples.useQuery(
    { take: 10, sinceDays: 7 },
    { staleTime: 60_000 },
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Link
          href="/system"
          className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
          aria-label="back to system"
        >
          <ChevronLeft size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
            Judge-eval · V1 vs V2
          </h1>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
            LLM-as-judge comparator · 4 dimensions · per-intent breakdown
          </p>
        </div>
      </header>

      {isLoading && !data && (
        <GlassCard>
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)] py-4 justify-center">
            <Loader2 size={12} className="animate-spin" />
            reading comparison runs…
          </div>
        </GlassCard>
      )}

      {error && (
        <GlassCard className="border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] text-rose-300 break-words">
              judge-eval summary fetch failed · {error.message}
            </p>
            <button
              onClick={() => void refetch()}
              className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-400/10"
            >
              retry
            </button>
          </div>
        </GlassCard>
      )}

      {data && (
        <>
          {/* Verdict chip · the headline */}
          <GlassCard className={cn("border", VERDICT_TONE[data.verdict as Verdict])}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">
                {data.verdict === "safe" ? (
                  <CheckCircle2 size={18} className="text-emerald-400" />
                ) : data.verdict === "regressing" ? (
                  <AlertTriangle size={18} className="text-rose-400" />
                ) : data.verdict === "watch" ? (
                  <Eye size={18} className="text-amber-400" />
                ) : (
                  <Scale size={18} className="text-[var(--text-tertiary)]" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono uppercase tracking-[0.14em] opacity-70 mb-0.5">
                  Phase 1 canary verdict · 7d window
                </p>
                <p className="text-sm font-bold uppercase tracking-wider">
                  {data.verdict.replace("-", " ")}
                </p>
                <p className="text-[11px] mt-1 leading-relaxed">
                  {data.verdictReason}
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Rolling buckets */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <BucketCard
              label="last 7d"
              total={data.last7d.total}
              v2Wins={data.last7d.v2Wins}
              v1Wins={data.last7d.v1Wins}
              ties={data.last7d.ties}
              v2WinPct={data.last7d.v2WinPct}
            />
            <BucketCard
              label="last 24h"
              total={data.last24h.total}
              v2Wins={data.last24h.v2Wins}
              v1Wins={data.last24h.v1Wins}
              ties={data.last24h.ties}
              v2WinPct={data.last24h.v2WinPct}
            />
          </div>

          {/* Per-intent breakdown */}
          {data.byIntent.length > 0 && (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Activity size={13} className="text-[var(--gold)]" />
                <span className="section-label">
                  By intent class · 7d
                </span>
              </div>
              <div className="space-y-1.5">
                {data.byIntent.map((b) => (
                  <IntentRow
                    key={b.intentClass}
                    intentClass={b.intentClass}
                    total={b.total}
                    v2Wins={b.v2Wins}
                    v1Wins={b.v1Wins}
                    v2WinPct={b.v2WinPct}
                  />
                ))}
              </div>
            </GlassCard>
          )}

          {/* Recent runs */}
          <GlassCard>
            <div className="flex items-center gap-2 mb-3">
              <Scale size={13} className="text-[var(--gold)]" />
              <span className="section-label">
                Recent runs · {data.recent.length}
              </span>
            </div>
            {data.recent.length === 0 ? (
              <p className="text-[11px] text-[var(--text-tertiary)] italic">
                No comparison runs yet · trigger one via{" "}
                <code className="text-[var(--gold)]">POST /api/judge-eval/run</code>
              </p>
            ) : (
              <div className="space-y-2">
                {data.recent.map((r) => (
                  <RecentRun key={r.id} r={r} />
                ))}
              </div>
            )}
          </GlassCard>

          <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] text-center">
            generated · {new Date(data.generatedAt).toLocaleTimeString()} ·
            mean v2Score {data.meanV2Score >= 0 ? data.meanV2Score.toFixed(1) : "—"}
          </p>
        </>
      )}
    </div>
  );
}

interface BucketProps {
  label: string;
  total: number;
  v2Wins: number;
  v1Wins: number;
  ties: number;
  v2WinPct: number;
}

function BucketCard({ label, total, v2Wins, v1Wins, ties, v2WinPct }: BucketProps) {
  return (
    <GlassCard>
      <div className="flex items-baseline justify-between mb-2">
        <span className="section-label">{label}</span>
        <span
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider tabular-nums",
            v2WinPct >= 50
              ? "text-emerald-300"
              : v2WinPct >= 40
                ? "text-amber-300"
                : v2WinPct >= 0
                  ? "text-rose-300"
                  : "text-[var(--text-tertiary)]",
          )}
        >
          {v2WinPct >= 0 ? `v2 ${v2WinPct}%` : "no runs"}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <Cell label="total" value={total} tone="tertiary" />
        <Cell label="v2 wins" value={v2Wins} tone="emerald" />
        <Cell label="v1 wins" value={v1Wins} tone="rose" />
        <Cell label="ties" value={ties} tone="tertiary" />
      </div>
    </GlassCard>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "rose" | "tertiary";
}) {
  const colorMap = {
    emerald: "text-emerald-300",
    rose: "text-rose-300",
    tertiary: "text-[var(--text-secondary)]",
  };
  return (
    <div className="rounded bg-[var(--bg-base)]/40 border border-[var(--border-default)] px-1.5 py-1.5 text-center">
      <div className={cn("text-base font-bold tabular-nums", colorMap[tone])}>
        <AnimatedCounter value={value} />
      </div>
      <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mt-0.5">
        {label}
      </p>
    </div>
  );
}

function IntentRow({
  intentClass,
  total,
  v2Wins,
  v1Wins,
  v2WinPct,
}: {
  intentClass: string;
  total: number;
  v2Wins: number;
  v1Wins: number;
  v2WinPct: number;
}) {
  return (
    <div className="px-2 py-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="font-mono text-[var(--text-secondary)] flex-1 min-w-0 truncate">
          {intentClass}
        </span>
        <span className="font-mono text-[var(--text-tertiary)] tabular-nums shrink-0">
          {v1Wins}v1 · {v2Wins}v2
        </span>
        <span
          className={cn(
            "font-mono tabular-nums text-[10px] px-1.5 py-0.5 rounded shrink-0",
            v2WinPct >= 50
              ? "bg-emerald-500/15 text-emerald-300"
              : v2WinPct >= 40
                ? "bg-amber-500/15 text-amber-300"
                : "bg-rose-500/15 text-rose-300",
          )}
        >
          {v2WinPct}%
        </span>
      </div>
      {/* Stacked bar · v2 wins (emerald) + ties (gray) + v1 wins (rose) */}
      <div className="mt-1 h-1.5 rounded-full bg-[var(--bg-void)] overflow-hidden flex">
        <div
          className="h-full bg-emerald-400"
          style={{ width: `${(v2Wins / total) * 100}%` }}
        />
        <div
          className="h-full bg-rose-400"
          style={{ width: `${(v1Wins / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

interface RecentRunData {
  id: string;
  prompt: string;
  v1Reply: string;
  v2Reply: string;
  intentClass: string | null;
  createdAt: string;
  judgment: {
    winner: Winner;
    v2Score: number;
    summary: string;
    dimensions: Array<{ dimension: string; winner: Winner; reason: string }>;
    parsed: boolean;
  };
}

function RecentRun({ r }: { r: RecentRunData }) {
  return (
    <details className="rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40 overflow-hidden">
      <summary className="px-2.5 py-2 cursor-pointer hover:bg-[var(--bg-void)]/40 select-none">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded",
              WINNER_TONE[r.judgment.winner],
            )}
          >
            {r.judgment.winner}
          </span>
          <span className="text-[10px] font-mono text-[var(--text-tertiary)] tabular-nums shrink-0">
            v2 {r.judgment.v2Score}
          </span>
          {r.intentClass && (
            <span className="text-[9px] font-mono text-[var(--gold)]/70 truncate shrink-0">
              {r.intentClass}
            </span>
          )}
          <span className="text-[10px] text-[var(--text-secondary)] truncate flex-1">
            {r.prompt.slice(0, 100)}
          </span>
          <span className="text-[9px] font-mono text-[var(--text-tertiary)] shrink-0">
            {new Date(r.createdAt).toLocaleTimeString()}
          </span>
        </div>
      </summary>
      <div className="px-2.5 py-2 border-t border-[var(--border-default)] bg-[var(--bg-void)]/30 space-y-2">
        <p className="text-[10px] text-[var(--text-secondary)] italic">
          {r.judgment.summary}
        </p>
        <div className="grid grid-cols-2 gap-1">
          {r.judgment.dimensions.map((d) => (
            <div
              key={d.dimension}
              className="px-1.5 py-1 rounded border border-[var(--border-default)] bg-[var(--bg-base)]/40"
            >
              <div className="flex items-center justify-between text-[9px]">
                <span className="font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  {d.dimension}
                </span>
                <span
                  className={cn(
                    "font-mono uppercase px-1 py-0.5 rounded",
                    WINNER_TONE[d.winner],
                  )}
                >
                  {d.winner}
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-secondary)] leading-snug mt-0.5">
                {d.reason}
              </p>
            </div>
          ))}
        </div>
        {!r.judgment.parsed && (
          <p className="text-[10px] text-amber-300/80 italic">
            ⚠ judge response not parseable · default tie returned
          </p>
        )}
      </div>
    </details>
  );
}
