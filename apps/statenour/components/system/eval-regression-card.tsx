"use client";

/**
 * v10.0.524 · EvalRegressionCard
 *
 * Dashboard card for the nightly eval regression harness. Shows:
 *   · Latest pass rate (big number, gold when ≥ 80%, rose when below)
 *   · 7-day sparkline of pass rate (text bars — no chart library)
 *   · Top 3 failing question IDs with one-line reason
 *   · Tap to expand all failures from the latest run
 *
 * Editorial-minimalist · dark · gold accent only · no purple gradients,
 * no Inter, no AI-slop symmetric rounding. Mirrors SchemaDriftCard.
 */

import { useCallback, useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { CheckCircle, AlertTriangle, ChevronRight } from "lucide-react";

interface PerQuestion {
  id: string;
  category: string;
  passed: boolean;
  score: number;
  failures: string[];
  toolCalls?: string[];
  durationMs?: number;
  pipelineError?: string;
}

interface EvalRun {
  id: string;
  key: string;
  summary: string;
  ranAt: string;
  totalRan: number;
  passed: number;
  failed: number;
  passRate: number;
  scoreAvg: number;
  durationMs: number;
  worstCategories: Array<{ category: string; failed: number; total: number }>;
  perQuestionResults?: PerQuestion[];
}

const PASS_THRESHOLD = 0.8;

export function EvalRegressionCard() {
  const [runs, setRuns] = useState<EvalRun[] | null>(null);
  const [drillRun, setDrillRun] = useState<EvalRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/system/eval-results?limit=7");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = (await res.json()) as
        | { data?: { results: EvalRun[] } }
        | { results: EvalRun[] };
      const results =
        ("data" in j && j.data?.results) || ("results" in j && j.results) || [];
      setRuns(results);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLatestDetail = useCallback(async () => {
    try {
      const res = await authedFetch("/api/system/eval-results?limit=1");
      if (!res.ok) return;
      const j = (await res.json()) as
        | { data?: { results: EvalRun[] } }
        | { results: EvalRun[] };
      const results =
        ("data" in j && j.data?.results) || ("results" in j && j.results) || [];
      if (results[0]) setDrillRun(results[0]);
    } catch {
      // soft-fail · drill-down view stays in summary mode
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !runs) {
    return (
      <GlassCard>
        <p className="text-[11px] text-[var(--text-tertiary)]">
          loading eval history…
        </p>
      </GlassCard>
    );
  }

  if (error && !runs) {
    return (
      <GlassCard>
        <p className="text-[11px] text-rose-400">
          eval-results unavailable: {error}
        </p>
      </GlassCard>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <GlassCard>
        <div className="flex items-center justify-between mb-2">
          <span className="section-label">Eval regression</span>
          <FreshnessChip
            lastFetchedAt={new Date().toISOString()}
            source="api/system/eval-results"
            onReload={() => void load()}
            compact
          />
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)]">
          No runs recorded yet. Cron fires nightly · check back tomorrow.
        </p>
      </GlassCard>
    );
  }

  const latest = runs[0];
  const isGreen = latest.passRate >= PASS_THRESHOLD;
  const topFailures =
    drillRun?.perQuestionResults?.filter((q) => !q.passed) ??
    latest.perQuestionResults?.filter((q) => !q.passed) ??
    [];

  // Sparkline · 7 vertical bars · height proportional to passRate.
  // We use unicode block characters · no chart lib, no SVG, deploys
  // free everywhere.
  const sparkline = runs
    .slice()
    .reverse()
    .map((r) => barFor(r.passRate))
    .join("");

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isGreen ? (
            <CheckCircle size={14} className="text-emerald-400" />
          ) : (
            <AlertTriangle size={14} className="text-rose-400" />
          )}
          <span className="section-label">Eval regression</span>
        </div>
        <FreshnessChip
          lastFetchedAt={latest.ranAt}
          source="api/system/eval-results"
          onReload={() => void load()}
          compact
        />
      </div>

      <div className="flex items-baseline gap-3 mb-3">
        <span
          className={
            "font-mono text-2xl tracking-tight " +
            (isGreen ? "text-[var(--gold)]" : "text-rose-300")
          }
        >
          {(latest.passRate * 100).toFixed(0)}%
        </span>
        <span className="text-[11px] text-[var(--text-tertiary)]">
          {latest.passed}/{latest.totalRan} passed · score{" "}
          {latest.scoreAvg.toFixed(2)}
        </span>
      </div>

      {runs.length > 1 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
            last {runs.length} runs
          </p>
          <p className="font-mono text-[var(--text-secondary)] text-sm leading-none">
            {sparkline}
          </p>
        </div>
      )}

      {latest.worstCategories && latest.worstCategories.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
            by category
          </p>
          <ul className="space-y-0.5">
            {latest.worstCategories.slice(0, 5).map((c) => (
              <li
                key={c.category}
                className="text-[11px] flex justify-between"
              >
                <span className="text-[var(--text-secondary)]">{c.category}</span>
                <span
                  className={
                    c.failed > 0
                      ? "text-rose-300 font-mono"
                      : "text-emerald-400 font-mono"
                  }
                >
                  {c.total - c.failed}/{c.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topFailures.length > 0 && (
        <div>
          <button
            onClick={() => {
              setExpanded((v) => !v);
              if (!drillRun) void loadLatestDetail();
            }}
            className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
          >
            <ChevronRight
              size={12}
              className={
                "transition-transform " + (expanded ? "rotate-90" : "")
              }
            />
            {expanded ? "hide" : "show"} failures ({topFailures.length})
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1.5">
              {topFailures.slice(0, 10).map((q) => (
                <li
                  key={q.id}
                  className="rounded-sm border border-rose-500/20 bg-rose-500/5 p-2 text-[11px]"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-rose-300 opacity-80">
                      {q.category}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                      {q.id}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[var(--text-secondary)] break-words">
                    {q.failures[0] ?? q.pipelineError ?? "fail"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </GlassCard>
  );
}

/**
 * Map a 0-1 pass rate to a unicode bar character. Eight gradations
 * give us a recognizable sparkline shape without any chart library.
 */
function barFor(rate: number): string {
  const clamped = Math.max(0, Math.min(1, rate));
  if (clamped < 0.125) return "▁";
  if (clamped < 0.25) return "▂";
  if (clamped < 0.375) return "▃";
  if (clamped < 0.5) return "▄";
  if (clamped < 0.625) return "▅";
  if (clamped < 0.75) return "▆";
  if (clamped < 0.875) return "▇";
  return "█";
}
