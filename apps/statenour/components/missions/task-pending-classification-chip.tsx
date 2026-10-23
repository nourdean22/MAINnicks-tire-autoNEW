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

import { toast } from "sonner";
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
  // The DECIDE row is built by task.deck: invalidating only task.list left it on screen for up to 45 s (map F3).
  const refresh = () => Promise.all([utils.task.list.invalidate(), utils.task.deck.invalidate()]);
  const accept = trpc.task.acceptTaskClassification.useMutation({
    onSuccess: () => void refresh(),
    onError: (err) => toast.error(err.message || "Could not attach. File the task yourself."),
  });
  const dismiss = trpc.task.dismissTaskClassification.useMutation({
    onSuccess: () => void refresh(),
  });

  const pc = (pending ?? null) as PendingTaskClassification | null;
  if (!pc || !pc.missionId) return null;

  const busy = accept.isPending || dismiss.isPending;
  const conf =
    typeof pc.confidence === "number"
      ? Math.round(Math.max(0, Math.min(1, pc.confidence)) * 100)
      : null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-control border border-edge-default bg-surface-raised px-2 py-1">
      <span className="font-mono text-[11px] text-fg-secondary">
        Suggested mission{conf != null ? ` · ${conf}% (est.)` : " (hypothesis)"}
      </span>
      {pc.rationale && (
        <span className="text-[11px] text-fg-tertiary truncate max-w-[14rem]">
          {pc.rationale}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => accept.mutate({ taskId })}
          className="inline-flex min-h-[44px] items-center rounded-micro px-2 text-[12px] font-medium text-fg transition-colors duration-[var(--motion-state)] hover:bg-surface-hover disabled:opacity-50"
        >
          {accept.isPending ? "Attaching…" : "Attach"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => dismiss.mutate({ taskId })}
          className="inline-flex min-h-[44px] items-center rounded-micro px-2 text-[12px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg disabled:opacity-50"
        >
          dismiss
        </button>
      </span>
    </div>
  );
}
