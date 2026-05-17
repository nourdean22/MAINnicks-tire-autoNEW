"use client";

/**
 * WaitingBand — surfaces tasks parked in status=WAITING.
 *
 * Apr 26 · F3 of the NOW-mode upgrades. When the stale-chip "+ blocker"
 * button gets tapped (or the expanded panel snooze flow flags one), the
 * task moves to status=WAITING and falls out of the main stream filter.
 * Without this band, those tasks vanish into a black hole. The band
 * keeps them visible-but-quiet until the blocker clears.
 *
 * Each row shows: title (truncated), waitingOn label, and a one-tap
 * "unblock" action that flips the row back to READY + clears the
 * waitingOn field.
 *
 * Quiet by default — collapsed to a single header row, expandable to
 * see the list. Saves vertical real estate on a long stream.
 */

import { useState, useCallback } from "react";
import { Hourglass, ChevronDown, ChevronUp, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskReviewActions } from "@/hooks/use-task-review-actions";
import { daysSince as ds } from "@/components/actions/shared";
import type { Task } from "@/components/actions/shared";

interface WaitingBandProps {
  tasks: Task[];
  onChange?: () => void | Promise<void>;
}

export function WaitingBand({ tasks, onChange }: WaitingBandProps) {
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const review = useTaskReviewActions({
    source: "page:tasks/now/waiting-band",
    onChange,
  });

  const unblock = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        // Flip status WAITING → READY and clear waitingOn. Reuse the
        // generic `edit` verb so the same PATCH path handles both
        // fields atomically.
        await review.edit(id, { status: "READY", waitingOn: null });
      } finally {
        setBusyId(null);
      }
    },
    [review],
  );

  if (tasks.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-sky-500/15 bg-sky-500/[0.02]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-sky-500/[0.04] transition-colors rounded-lg"
      >
        <Hourglass size={11} className="text-sky-400/70 shrink-0" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-sky-300/80">
          waiting · {tasks.length}
        </span>
        <span className="text-[9px] text-sky-400/40 italic ml-1 truncate flex-1">
          {tasks
            .slice(0, 2)
            .map((t) => t.waitingOn || "blocker unspecified")
            .join(" · ")}
          {tasks.length > 2 && ` · +${tasks.length - 2} more`}
        </span>
        {expanded ? (
          <ChevronUp size={11} className="text-sky-400/50 shrink-0" />
        ) : (
          <ChevronDown size={11} className="text-sky-400/50 shrink-0" />
        )}
      </button>
      {expanded && (
        <ul className="border-t border-sky-500/10 divide-y divide-sky-500/5">
          {tasks.map((t) => {
            const stale = ds(t.lastTouchedAt || t.updatedAt) || 0;
            // v10.0.529.84 · Wave 28 · A1/B1 · render snooze wake date
            // when the task is snoozed (not vendor-blocked). Without
            // this, a task snoozed until friday looked identical to
            // one blocked on a vendor indefinitely.
            const snoozedDate = t.snoozedUntil ? new Date(t.snoozedUntil) : null;
            const isSnoozed = snoozedDate && !Number.isNaN(snoozedDate.getTime());
            const snoozeLabel = isSnoozed
              ? (() => {
                  const now = new Date();
                  const d = snoozedDate!;
                  const sameDay =
                    d.getFullYear() === now.getFullYear() &&
                    d.getMonth() === now.getMonth() &&
                    d.getDate() === now.getDate();
                  if (sameDay) return "today";
                  const tomorrow = new Date(now);
                  tomorrow.setDate(now.getDate() + 1);
                  if (
                    d.getFullYear() === tomorrow.getFullYear() &&
                    d.getMonth() === tomorrow.getMonth() &&
                    d.getDate() === tomorrow.getDate()
                  ) {
                    return "tomorrow";
                  }
                  return d.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  });
                })()
              : null;
            return (
              <li key={t.id} className="flex items-start gap-2 px-3 py-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400/60" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-zinc-300 truncate">{t.title}</p>
                  <p className="text-[9px] text-sky-300/70 mt-0.5">
                    {isSnoozed ? (
                      <>
                        snoozed · wakes{" "}
                        <span className="text-sky-200/90 font-medium">
                          {snoozeLabel}
                        </span>
                      </>
                    ) : (
                      <>
                        waiting on{" "}
                        <span className="text-sky-200/90 font-medium">
                          {t.waitingOn || "—"}
                        </span>
                      </>
                    )}
                    {stale > 0 && !isSnoozed && (
                      <span className="text-zinc-600"> · {stale}d</span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void unblock(t.id)}
                  disabled={busyId === t.id}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/5",
                    "px-2 py-1 text-[10px] font-medium text-sky-300 hover:bg-sky-500/15",
                    "disabled:opacity-50",
                  )}
                >
                  {busyId === t.id ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Play size={10} />
                  )}
                  unblock
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
