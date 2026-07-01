"use client";

/**
 * TaskPendingClassificationChip · 2026-06-01 · suggest-then-approve.
 *
 * When enrichTaskLinkage finds a LOW-confidence mission match (below the
 * silent-attach bar) it parks the proposal on Task.pendingClassification
 * instead of silently attaching or dropping it. This chip surfaces it on
 * the task row: the operator accepts (applies the mission/goal/statHints)
 * or dismisses (clears it). Mirrors /people's PendingClassificationBanner.
 *
 * Self-contained: calls the mutations + invalidates the task list itself,
 * so it drops into a presentational row with no prop-drilling.
 */

import { trpc } from "@/lib/trpc/client";

interface PendingTaskClassification {
  missionId?: string | null;
  goalId?: string | null;
  statHints?: string[] | null;
  confidence?: number;
  rationale?: string;
}

export function TaskPendingClassificationChip({
  taskId,
  pending,
}: {
  taskId: string;
  pending: unknown;
}) {
  const utils = trpc.useUtils();
  const accept = trpc.task.acceptTaskClassification.useMutation({
    onSuccess: () => void utils.task.list.invalidate(),
  });
  const dismiss = trpc.task.dismissTaskClassification.useMutation({
    onSuccess: () => void utils.task.list.invalidate(),
  });

  const pc = (pending ?? null) as PendingTaskClassification | null;
  if (!pc || !pc.missionId) return null;

  const busy = accept.isPending || dismiss.isPending;
  const conf =
    typeof pc.confidence === "number"
      ? Math.round(Math.max(0, Math.min(1, pc.confidence)) * 100)
      : null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/[0.06] px-2 py-1">
      <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--gold)]">
        suggested mission{conf != null ? ` · ${conf}% (est.)` : " (hypothesis)"}
      </span>
      {pc.rationale && (
        <span className="text-[10px] text-[var(--text-tertiary)] truncate max-w-[14rem]">
          {pc.rationale}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => accept.mutate({ taskId })}
          className="inline-flex min-h-[28px] items-center rounded px-2 text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--gold)] hover:bg-[var(--gold)]/10 disabled:opacity-50"
        >
          {accept.isPending ? "attaching…" : "attach"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => dismiss.mutate({ taskId })}
          className="inline-flex min-h-[28px] items-center rounded px-2 text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-50"
        >
          dismiss
        </button>
      </span>
    </div>
  );
}
