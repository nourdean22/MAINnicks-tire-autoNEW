"use client";

/**
 * deck-triage.tsx · the airlock rows, rendered inside the DECIDE sheet.
 *
 * Captures, real mission suggestions, rescue findings and tasks not yet in a
 * mission queue here with one-tap verbs. The count line lives in deck-decide;
 * this list shows "+N more" whenever the rows are capped. Delete goes through
 * the parent's confirm (the house dialog, never window.confirm).
 */
import Link from "next/link";
import type { MissionsDeck } from "@/lib/missions/deck";
import { TaskPendingClassificationChip } from "@/components/missions/task-pending-classification-chip";
import type { Task } from "@/components/actions/shared";
import { inDaysMorning } from "@/lib/missions/snooze-presets";
import { ReadFailed } from "@/components/ui/read-failed";

type Props = {
  triage: MissionsDeck["triage"];
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onSnoozeTask: (taskId: string, untilIso: string) => Promise<boolean>;
  onDeleteTask: (taskId: string) => Promise<void> | void;
  /** A source failed to read: an empty list is not "nothing to decide". */
  incomplete?: boolean;
  /** Refetches the deck; shown with the incomplete line. */
  onRetry?: () => void;
};

const VERB =
  "inline-flex min-h-[44px] shrink-0 items-center rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg";

export function DeckTriage({ triage, tasks, onEditTask, onSnoozeTask, onDeleteTask, incomplete = false, onRetry }: Props) {
  if (triage.rows.length === 0) {
    return incomplete && onRetry ? (
      <ReadFailed onRetry={onRetry}>Part of this queue could not be read, so it may not be empty.</ReadFailed>
    ) : (
      <p className="text-[15px] text-fg-tertiary">
        {incomplete ? "Part of this queue could not be read, so it may not be empty." : "Nothing to decide right now."}
      </p>
    );
  }
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  return (
    <div>
      {/* A source failed to read but others still answered: the rows below are not the whole queue
          (Codex P2 on #3354), so the Retry shows beside them, not only on an empty list. */}
      {incomplete && onRetry && (
        <div className="mb-3">
          <ReadFailed onRetry={onRetry}>Part of this queue could not be read, so more may be waiting.</ReadFailed>
        </div>
      )}
      <ul className="divide-y divide-edge">
        {triage.rows.map((row) => {
          const task = row.taskId ? taskById.get(row.taskId) : undefined;
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-[15px] text-fg">{row.title}</p>
                {row.detail && <p className="truncate text-[12px] text-fg-tertiary">{row.detail}</p>}
              </div>

              {/* /system/inbox lists quarantined memories, not capture rows (audit 10-U3). */}
              {row.kind === "capture" && (
                <Link href="/system/inbox" className={VERB}>
                  Memory inbox
                </Link>
              )}

              {row.kind === "classify" && task && (
                <TaskPendingClassificationChip
                  taskId={task.id}
                  pending={(task as { pendingClassification?: unknown }).pendingClassification}
                />
              )}

              {(row.kind === "unattached" || row.kind === "rescue") && task && (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button type="button" onClick={() => onEditTask(task)} className={VERB}>
                    File it
                  </button>
                  <button type="button" onClick={() => void onSnoozeTask(task.id, inDaysMorning(7))} className={VERB}>
                    Next week
                  </button>
                  <button type="button" onClick={() => void onDeleteTask(task.id)} aria-label={`Delete ${task.title}`} className={VERB}>
                    Delete
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {triage.totalCount > triage.rows.length && (
        <p className="pt-2 font-mono text-[11px] text-fg-tertiary">
          +{triage.totalCount - triage.rows.length} more after these
        </p>
      )}
    </div>
  );
}
