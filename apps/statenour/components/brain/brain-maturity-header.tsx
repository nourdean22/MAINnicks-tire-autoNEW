"use client";

/**
 * BrainMaturityHeader — aggregate score + counters at the top of
 * /brain. Reads from /api/brain/maturity which rolls up the subsystem
 * counts + the qualitative completeness so Nour has one number to
 * track "the brain is learning" at a glance.
 */

import { useCallback, useEffect } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { cn } from "@/lib/utils";
import { Download, RotateCcw } from "lucide-react";
import { toast } from "sonner";
// Phase B.6d (2026-05-22) · migrated off `useAuthedFetch("/api/brain/
// maturity")` + `authedFetch` (export · reset) onto `trpc.brain` · the
// maturity read is `useQuery`, export is an imperative `utils.*.fetch`,
// reset is a `useMutation`.
import { trpc } from "@/lib/trpc/client";
import { AnimatedCounter } from "@/components/ui/animated-counter";

interface Maturity {
  score: number;               // 0-100 aggregate
  components: {
    skills: { active: number; graduated: number; pending: number };
    identity: { axes_filled: number; history_days: number };
    qualitative: { entries: number };
    beliefs: { active: number; candidates: number };
    contradictions: { open: number; resolved: number };
    ghost: { hits: number; surprises: number; accuracy: number | null };
    chat_memory: { importance_rows: number; distilled_sessions: number };
  };
  computed_at: string;
}

function dot(color: string): string {
  return color;
}

export function BrainMaturityHeader({ refreshKey = 0 }: { refreshKey?: number }) {
  // v11.1 · React Query drives the maturity read. The procedure already
  // returns the rollup unwrapped (the legacy route nested it under
  // `{ maturity }`) so the call-site reads `maturityQuery.data` directly.
  // refreshKey from the parent /brain page polling loop is forwarded as
  // a no-op query input so a bump triggers a refetch on cadence.
  const utils = trpc.useUtils();
  const maturityQuery = trpc.brain.maturity.useQuery(undefined);
  const resetMutation = trpc.brain.reset.useMutation();
  const data = (maturityQuery.data as Maturity | undefined) ?? null;
  const loadError = maturityQuery.error?.message ?? null;

  // The parent bumps `refreshKey` on its polling cadence · refetch the
  // maturity rollup when it changes (skip the initial 0 mount · the
  // query fetches on mount already).
  const reload = useCallback(() => {
    void maturityQuery.refetch();
  }, [maturityQuery]);

  const exportBrain = useCallback(async () => {
    try {
      const payload = await utils.brain.exportBrain.fetch();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nour-brain-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("brain state downloaded");
    } catch (e) {
      toast.error(`export failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [utils]);

  const resetBrain = useCallback(async () => {
    const first = confirm("Reset the ENTIRE brain state? This clears skills, identity, beliefs, contradictions, ghost accuracy, qualitative identity, and chat importance rows. CANNOT be undone.");
    if (!first) return;
    const second = prompt('Type "reset my brain" to confirm.');
    if (second !== "reset my brain") {
      toast.info("reset cancelled");
      return;
    }
    try {
      await resetMutation.mutateAsync();
      toast.success("brain reset · reload to refresh");
    } catch (e) {
      toast.error(`reset failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [resetMutation]);

  // The parent /brain polling loop bumps `refreshKey` on cadence ·
  // refetch the maturity rollup on each bump (the initial 0 is the
  // mount fetch React Query already does).
  useEffect(() => {
    if (refreshKey > 0) void maturityQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (!data) {
    // v11.1 · Error state with retry. Previously just spun "reading
    // brain state…" forever when the endpoint errored.
    if (loadError) {
      return (
        <GlassCard>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-rose-300">brain-maturity fetch failed</p>
              <p className="text-[10px] text-rose-300/70 mt-0.5 break-words font-mono">{loadError}</p>
            </div>
            <button
              onClick={reload}
              className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-400/10 transition-colors"
            >
              retry
            </button>
          </div>
        </GlassCard>
      );
    }
    return (
      <GlassCard>
        <p className="text-[11px] text-[var(--text-tertiary)]">reading brain state…</p>
      </GlassCard>
    );
  }

  const score = data.score;
  const scoreColor =
    score >= 75 ? "text-emerald-400" :
    score >= 50 ? "text-[var(--gold)]" :
    score >= 30 ? "text-amber-400" : "text-red-400";

  const c = data.components;
  const ghostAcc = c.ghost.accuracy != null ? `${Math.round(c.ghost.accuracy * 100)}%` : "—";

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => void exportBrain()}
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30 inline-flex items-center gap-1"
            title="download full brain JSON"
          >
            <Download size={10} />
            export
          </button>
          <button
            onClick={() => void resetBrain()}
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 inline-flex items-center gap-1"
            title="nuke everything (double-confirm required)"
          >
            <RotateCcw size={10} />
            reset
          </button>
        </div>
        {/* v8.2 D5 — every data card shows freshness + source */}
        <FreshnessChip
          lastFetchedAt={data.computed_at}
          source="api/brain/maturity"
          onReload={() => reload()}
          compact
        />
      </div>
      <div className="flex items-center gap-4">
        <div className="shrink-0">
          <p className={cn("text-[32px] font-mono tabular-nums leading-none", scoreColor)}>
            <AnimatedCounter value={score} duration={900} />
          </p>
          <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mt-1">
            brain maturity
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 flex-1 text-[10px] font-mono">
          <Counter label="skills active" value={c.skills.active} />
          <Counter label="skills graduated" value={c.skills.graduated} color={dot("text-violet-400")} />
          <Counter label="skill candidates" value={c.skills.pending} color={dot("text-blue-400")} />
          <Counter label="identity axes" value={`${c.identity.axes_filled}/8`} />
          <Counter label="qual entries" value={c.qualitative.entries} />
          <Counter label="beliefs active" value={c.beliefs.active} />
          <Counter
            label="contradictions"
            value={c.contradictions.open}
            color={c.contradictions.open > 0 ? dot("text-red-400") : dot("text-emerald-400")}
          />
          <Counter label="ghost acc" value={ghostAcc} />
        </div>
      </div>
      <p className="text-[9px] text-[var(--text-tertiary)] mt-3">
        Rollup of all 7 brain subsystems. Refreshes every minute on this page. Higher score = the
        brain has more signal about who you are and how you operate.
      </p>
    </GlassCard>
  );
}

function Counter({ label, value, color }: { label: string; value: number | string; color?: string }) {
  // v11.1 D5 · animate numeric values so counters tick up on load
  // and on refresh. Pass-through for string values (e.g. "42%").
  const body =
    typeof value === "number" ? <AnimatedCounter value={value} duration={700} /> : value;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--text-tertiary)]">{label}</span>
      <span className={cn("tabular-nums", color ?? "text-[var(--text-primary)]")}>{body}</span>
    </div>
  );
}
