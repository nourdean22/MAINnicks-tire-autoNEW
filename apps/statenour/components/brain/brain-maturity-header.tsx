"use client";

/**
 * BrainMaturityHeader: aggregate score + counters at the top of
 * /brain. Reads from /api/brain/maturity which rolls up the subsystem
 * counts + the qualitative completeness so Nour has one number to
 * track "the brain is learning" at a glance.
 */

import { useCallback, useEffect } from "react";
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
// FAILED: never zero. See UNKNOWN below.
interface Maturity {
  score: number | null;        // aggregate · null when a read failed
  /** What `score` is out of: a constant 90. */
  scoreMax: number;
  components: {
    skills: { active: number | null; graduated: number | null; pending: number | null };
    identity: { axes_filled: number | null; history_days: number | null };
    qualitative: { entries: number | null };
    beliefs: { active: number | null; candidates: number | null };
    contradictions: { open: number | null };
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
 * deliberately NOT "none": "none" already means "measured, nothing to show"
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
      body: "This clears skills, identity, beliefs, ghost accuracy, qualitative identity, and chat importance rows. The claim-vs-record contradictions list is not touched. CANNOT be undone.",
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

  // Wave D (2026-10-24): ONE ruled line (it was three cards: failed, loading, data). The score, the
  // counters and the two actions share a row; the failed and loading states keep the same frame.
  if (!data) {
    // v11.1 · Error state with retry. Previously just spun "reading brain state…" forever when the
    // endpoint errored.
    if (loadError) {
      return (
        <section aria-label="brain maturity" data-read-failed="" className="flex flex-wrap items-center justify-between gap-3 border-y border-edge py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-red-300">Brain maturity couldn&apos;t load: state unknown, not empty.</p>
            <p className="mt-0.5 break-words font-mono text-[13px] text-red-300/80">{loadError}</p>
          </div>
          <button
            type="button"
            onClick={reload}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-control border border-red-400/40 px-4 text-[13px] font-medium text-red-300 transition-colors duration-[var(--motion-state)] hover:bg-red-400/10"
          >
            Retry
          </button>
        </section>
      );
    }
    return (
      <section aria-label="brain maturity" aria-busy="true" className="border-y border-edge py-3">
        <p className="text-[13px] text-fg-tertiary">Reading brain state…</p>
      </section>
    );
  }

  // A DEGRADED READ IS NOT A LOW SCORE. `buildBrainMaturity` used to swallow all ten subsystem reads
  // and return a fully-formed payload, so the `if (!data)` guard above never fired on a total DB
  // failure: it rendered "7" with every counter at 0 and "contradictions 0" in emerald. The service
  // now suppresses the score and lists the reads that threw; this branch is what makes that visible.
  const failedReads = data.failedReads ?? [];
  const degraded = failedReads.length > 0;
  const score = data.score;
  const scoreColor =
    score == null ? "text-amber-400" :
    score >= 75 ? "text-emerald-400" :
    score >= 50 ? "text-fg-secondary" :
    score >= 30 ? "text-amber-400" : "text-red-400";

  const c = data.components;
  const ghostAcc =
    c.ghost.accuracy != null
      ? `${Math.round(c.ghost.accuracy * 100)}%`
      : failedReads.includes("ghost_accuracy")
        ? UNKNOWN
        : "none";

  return (
    <section aria-label="brain maturity" className="border-y border-edge py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-baseline gap-2">
          <p className={cn("text-[22px] font-mono tabular-nums leading-none", scoreColor)}>
            {score == null ? UNKNOWN : <AnimatedCounter value={score} duration={900} />}
            {/* The denominator is shown only when it is NOT 100 (it is a constant 90 now:
                contradictions carry no points), so the common case reads /90. */}
            {score != null && data.scoreMax !== 100 && (
              <span className="text-[13px] text-fg-tertiary">/{data.scoreMax}</span>
            )}
          </p>
          <p className="text-[13px] text-fg-tertiary">
            {score == null ? "Maturity unknown" : "Brain maturity"}
          </p>
        </div>

        <div className="flex flex-1 flex-wrap gap-x-4 gap-y-1 font-mono text-[13px]">
          <Counter label="skills active" value={counterValue(c.skills.active)} />
          <Counter label="skills graduated" value={counterValue(c.skills.graduated)} />
          <Counter label="skill candidates" value={counterValue(c.skills.pending)} />
          <Counter
            label="identity axes"
            value={c.identity.axes_filled == null ? UNKNOWN : `${c.identity.axes_filled}/8`}
          />
          <Counter label="qual entries" value={counterValue(c.qualitative.entries)} />
          <Counter label="beliefs active" value={counterValue(c.beliefs.active)} />
          {/* EMERALD IS A CLAIM, and it must not be reachable from a failed read. `open === null`
              means the contradiction ledger could not be read at all: amber, never the green that
              used to say "internally consistent" about a read that never happened. */}
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void exportBrain()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
            title="Download the full brain as JSON"
          >
            <Download size={12} aria-hidden />
            Export
          </button>
          <button
            type="button"
            onClick={() => void resetBrain()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-red-500/30 px-4 text-[13px] font-medium text-red-300 transition-colors duration-[var(--motion-state)] hover:bg-red-500/10"
            title="Reset the brain (asks twice)"
          >
            <RotateCcw size={12} aria-hidden />
            Reset
          </button>
          {/* v8.2 D5: every data block shows freshness + source */}
          <FreshnessChip
            lastFetchedAt={data.computed_at}
            source="api/brain/maturity"
            onReload={() => reload()}
            compact
          />
        </div>
      </div>
      {degraded && (
        <p data-read-failed="" className="mt-3 border-l-2 border-amber-400/60 py-1 pl-4 text-[13px] leading-relaxed text-amber-300">
          <span className="font-mono text-amber-400">
            read failed: unknown, not zero
          </span>
          <br />
          {failedReads.length} subsystem read{failedReads.length === 1 ? "" : "s"} threw
          (<span className="font-mono">{failedReads.join(", ")}</span>). The score is
          withheld and every <span className="font-mono">{UNKNOWN}</span> above was not
          measured; none of them is a zero.
        </p>
      )}
      {/* iOS-PWA-safe two-gate reset mounts · render null when idle. */}
      {confirmDialog}
      {promptDialog}
    </section>
  );
}

function Counter({ label, value, color }: { label: string; value: number | string; color?: string }) {
  // v11.1 D5 · animate numeric values so counters tick up on load
  // and on refresh. Pass-through for string values (e.g. "42%").
  const body =
    typeof value === "number" ? <AnimatedCounter value={value} duration={700} /> : value;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-fg-tertiary">{label}</span>
      <span className={cn("tabular-nums", color ?? "text-fg")}>{body}</span>
    </div>
  );
}
