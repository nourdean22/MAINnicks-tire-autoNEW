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
import { useConfirmDialog, usePromptDialog } from "@/components/ui/confirm-dialog";

// Mirrors BrainMaturityView in lib/services/brain-domain.ts. Every counter
// is `number | null`, and `null` means the read that would have produced it
// FAILED — never zero. See UNKNOWN below.
interface Maturity {
  score: number | null;        // aggregate · null when a read failed
  /** What `score` is out of — below 100 when a dimension is unmeasurable. */
  scoreMax: number;
  components: {
    skills: { active: number | null; graduated: number | null; pending: number | null };
    identity: { axes_filled: number | null; history_days: number | null };
    qualitative: { entries: number | null };
    beliefs: { active: number | null; candidates: number | null };
    contradictions: { open: number | null; resolved: number | null };
    ghost: { hits: number | null; surprises: number | null; accuracy: number | null };
    chat_memory: { importance_rows: number | null; distilled_sessions: number | null };
  };
  failedReads: string[];
  computed_at: string;
}

function dot(color: string): string {
  return color;
}

/**
 * What a counter renders when its read failed. Deliberately NOT "0" and
 * deliberately NOT "—": "—" already means "measured, nothing to show"
 * elsewhere on this card (ghost accuracy with no scored predictions).
 */
const UNKNOWN = "?";

/** A counter value, or UNKNOWN when the read behind it failed. */
function counterValue(n: number | null): number | string {
  return n ?? UNKNOWN;
}

export function BrainMaturityHeader({ refreshKey = 0 }: { refreshKey?: number }) {
  // v11.1 · React Query drives the maturity read. The procedure already
  // returns the rollup unwrapped (the legacy route nested it under
  // `{ maturity }`) so the call-site reads `maturityQuery.data` directly.
  // refreshKey from the parent /brain page polling loop is forwarded as
  // a no-op query input so a bump triggers a refetch on cadence.
  const utils = trpc.useUtils();
  // iOS-PWA-safe two-gate reset · window.confirm()/prompt() are silently
  // suppressed in standalone mode · preserve danger-confirm THEN typed
  // "reset my brain" prompt before nuking the brain state.
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { prompt, dialog: promptDialog } = usePromptDialog();
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
    const first = await confirm({
      title: "Reset the ENTIRE brain state?",
      body: "This clears skills, identity, beliefs, contradictions, ghost accuracy, qualitative identity, and chat importance rows. CANNOT be undone.",
      confirmLabel: "Continue",
      tone: "danger",
    });
    if (!first) return;
    const second = await prompt({
      title: 'Type "reset my brain" to confirm.',
      placeholder: "reset my brain",
      confirmLabel: "Reset",
    });
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
  }, [resetMutation, confirm, prompt]);

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

  // A DEGRADED READ IS NOT A LOW SCORE. `buildBrainMaturity` used to
  // swallow all ten subsystem reads and return a fully-formed payload, so
  // this component's `if (!data)` guard above never fired on a total DB
  // failure — it rendered "7" with every counter at 0 and "contradictions
  // 0" in emerald. The service now suppresses the score and lists the
  // reads that threw; this branch is what makes that visible.
  const failedReads = data.failedReads ?? [];
  const degraded = failedReads.length > 0;
  const score = data.score;
  const scoreColor =
    score == null ? "text-amber-400" :
    score >= 75 ? "text-emerald-400" :
    score >= 50 ? "text-[var(--gold)]" :
    score >= 30 ? "text-amber-400" : "text-red-400";

  const c = data.components;
  const ghostAcc =
    c.ghost.accuracy != null
      ? `${Math.round(c.ghost.accuracy * 100)}%`
      : failedReads.includes("ghost_accuracy")
        ? UNKNOWN
        : "—";

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
            {score == null ? UNKNOWN : <AnimatedCounter value={score} duration={900} />}
            {/* 2026-09-02 · the denominator is shown only when it is NOT 100,
                so the common case stays uncluttered and the uncommon one
                cannot be misread. Production currently has zero
                contradictions ever recorded, so this renders /90 — a
                dimension with no data is excluded from the score and from
                its ceiling rather than paid a hardcoded 7. */}
            {score != null && data.scoreMax !== 100 && (
              <span className="text-[15px] text-[var(--text-tertiary)]">/{data.scoreMax}</span>
            )}
          </p>
          <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mt-1">
            {score == null ? "maturity unknown" : "brain maturity"}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 flex-1 text-[10px] font-mono">
          <Counter label="skills active" value={counterValue(c.skills.active)} />
          <Counter label="skills graduated" value={counterValue(c.skills.graduated)} color={dot("text-violet-400")} />
          <Counter label="skill candidates" value={counterValue(c.skills.pending)} color={dot("text-blue-400")} />
          <Counter
            label="identity axes"
            value={c.identity.axes_filled == null ? UNKNOWN : `${c.identity.axes_filled}/8`}
          />
          <Counter label="qual entries" value={counterValue(c.qualitative.entries)} />
          <Counter label="beliefs active" value={counterValue(c.beliefs.active)} />
          {/* EMERALD IS A CLAIM, and it must not be reachable from a failed
              read. `open === null` means the contradiction ledger could not
              be read at all — amber, never the green that used to say
              "internally consistent" about a read that never happened. */}
          <Counter
            label="contradictions"
            value={counterValue(c.contradictions.open)}
            color={
              c.contradictions.open == null
                ? dot("text-amber-400")
                : c.contradictions.open > 0
                  ? dot("text-red-400")
                  : dot("text-emerald-400")
            }
          />
          <Counter label="ghost acc" value={ghostAcc} />
        </div>
      </div>
      {degraded && (
        <p className="mt-3 text-[10px] text-amber-300/90 leading-relaxed border border-amber-500/25 bg-amber-500/[0.05] rounded px-2 py-1.5">
          <span className="font-mono uppercase tracking-wider text-amber-400">
            read failed — unknown, not zero
          </span>
          <br />
          {failedReads.length} subsystem read{failedReads.length === 1 ? "" : "s"} threw
          (<span className="font-mono">{failedReads.join(", ")}</span>). The score is
          withheld and every <span className="font-mono">{UNKNOWN}</span> above was not
          measured — none of them is a zero.
        </p>
      )}
      <p className="text-[9px] text-[var(--text-tertiary)] mt-3">
        Rollup of all 7 brain subsystems. Refreshes when brain data changes. Higher score = the
        brain has more signal about who you are and how you operate.
      </p>
      {/* iOS-PWA-safe two-gate reset mounts · render null when idle. */}
      {confirmDialog}
      {promptDialog}
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
