"use client";

/**
 * GoalNextActionsCard · v8.10 BATCH 56 · Apr 29.
 *
 * Renders /api/goals/next-actions output as a tinted card on /plan.
 * Silent when no goals are behind pace by ≥10 points (zero noise on
 * weeks where Nour's hitting his marks).
 *
 * Each nudge shows:
 *   · Goal title + domain
 *   · Pace delta (red, e.g. "-23 pts behind")
 *   · The single next action (clickable when sourced from a Task)
 *   · Source tag (task / memory / default)
 *
 * Composes:
 *   · v8.9 next-actions API (deterministic, no AI cost)
 *   · v7.9 LifeGoal soft-delete (API filters deletedAt:null)
 *   · v7.6 Task autoPriority (API picks highest-priority linked task)
 */

import { useCallback, useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { Target, ArrowRight } from "lucide-react";

interface NextAction {
  goalId: string;
  goalTitle: string;
  domain: string;
  paceDelta: number;
  source: "task" | "memory" | "default";
  text: string;
  refId: string | null;
}

interface ApiPayload {
  generatedAt: string;
  behindPaceCount: number;
  nextActions: NextAction[];
}

const SOURCE_TAG: Record<string, { label: string; tint: string }> = {
  task: { label: "task", tint: "text-emerald-300 bg-emerald-500/10" },
  memory: { label: "memory", tint: "text-blue-300 bg-blue-500/10" },
  default: { label: "default", tint: "text-zinc-400 bg-zinc-500/10" },
};

export function GoalNextActionsCard() {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/goals/next-actions");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = (await res.json()) as { data?: ApiPayload } & ApiPayload;
      setPayload(j.data ?? (j as ApiPayload));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !payload) {
    return (
      <GlassCard>
        <p className="text-[11px] text-[var(--text-tertiary)]">checking goal pace…</p>
      </GlassCard>
    );
  }

  if (error && !payload) {
    return (
      <GlassCard>
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-rose-400">next-actions unavailable: {error}</p>
          <button
            onClick={() => void load()}
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)]"
          >
            retry
          </button>
        </div>
      </GlassCard>
    );
  }

  if (!payload || payload.nextActions.length === 0) {
    return null; // Silent when nothing's behind pace
  }

  const nudges = payload.nextActions.slice(0, 3);

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-amber-400" />
          <span className="section-label">Behind-pace nudges</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400">
            {payload.behindPaceCount}
          </span>
        </div>
        <FreshnessChip
          lastFetchedAt={payload.generatedAt}
          source="api/goals/next-actions"
          onReload={() => void load()}
          compact
        />
      </div>

      <ul className="space-y-2">
        {nudges.map((n) => {
          const tag = SOURCE_TAG[n.source] ?? SOURCE_TAG.default;
          return (
            <li
              key={n.goalId}
              className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] font-semibold text-amber-200 truncate">
                  {n.goalTitle}
                </span>
                <span className="text-[10px] text-[var(--text-tertiary)]">·</span>
                <span className="text-[10px] text-[var(--text-tertiary)]">{n.domain}</span>
                <span className="ml-auto text-[10px] font-mono text-rose-300">
                  {n.paceDelta > 0 ? "+" : ""}
                  {Math.round(n.paceDelta)} pts
                </span>
              </div>
              <div className="flex items-start gap-2">
                <ArrowRight size={11} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-amber-100/90 flex-1">{n.text}</p>
                <span
                  className={
                    "ml-1 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider " +
                    tag.tint
                  }
                >
                  {tag.label}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {payload.nextActions.length > 3 && (
        <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">
          +{payload.nextActions.length - 3} more behind-pace goals
        </p>
      )}
    </GlassCard>
  );
}
