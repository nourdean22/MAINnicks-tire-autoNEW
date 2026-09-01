"use client";

/**
 * deck-triage.tsx — the airlock (Execution Deck §10.4).
 *
 * Raw intake never lands in "today": captures, Nick's pending
 * classifications, mission-less tasks, and rescue findings queue here
 * with one-tap verbs. Renders NOTHING when clear — quiet is the healthy
 * state (dark cockpit). The count is the whole-queue truth even when
 * rows are capped.
 */
import { useState } from "react";
import Link from "next/link";
import type { MissionsDeck } from "@/lib/missions/deck";
import { TaskPendingClassificationChip } from "@/components/missions/task-pending-classification-chip";
import type { Task } from "@/components/actions/shared";

type Props = {
  triage: MissionsDeck["triage"];
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onSnoozeTask: (taskId: string, untilIso: string) => void;
  onDeleteTask: (taskId: string) => void;
};

function nextWeekIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(6, 0, 0, 0);
  return d.toISOString();
}

export function DeckTriage({ triage, tasks, onEditTask, onSnoozeTask, onDeleteTask }: Props) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (triage.rows.length === 0) return null;

  const taskById = new Map(tasks.map((t) => [t.id, t]));

  return (
    <section
      aria-labelledby="triage-heading"
      className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] p-3 sm:p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="triage-heading" className="text-sm font-semibold text-[var(--text-primary)]">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--gold)]/80">
            decide
          </span>{" "}
          <span className="tabular-nums">({triage.totalCount})</span>
        </h2>
        {triage.totalCount > triage.rows.length && (
          <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
            showing {triage.rows.length} of {triage.totalCount}
          </span>
        )}
      </div>

      <ul className="mt-2 divide-y divide-[var(--border-default)]/60">
        {triage.rows.map((row) => {
          const task = row.taskId ? taskById.get(row.taskId) : undefined;
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-[var(--text-primary)]">{row.title}</p>
                {row.detail && (
                  <p className="truncate text-[10.5px] text-[var(--text-tertiary)]">{row.detail}</p>
                )}
              </div>

              {row.kind === "capture" && (
                <Link
                  href="/system/inbox"
                  className="shrink-0 rounded-md border border-[var(--border-default)] px-2.5 py-2 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] min-h-[44px] inline-flex items-center"
                >
                  open inbox ↗
                </Link>
              )}

              {row.kind === "classify" && task && (
                <TaskPendingClassificationChip
                  taskId={task.id}
                  pending={(task as { pendingClassification?: unknown }).pendingClassification}
                />
              )}

              {(row.kind === "unattached" || row.kind === "rescue") && task && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onEditTask(task)}
                    className="rounded-md border border-[var(--border-default)] px-2.5 py-2 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/40 hover:text-[var(--gold)] min-h-[44px]"
                  >
                    file it
                  </button>
                  <button
                    type="button"
                    onClick={() => onSnoozeTask(task.id, nextWeekIso())}
                    className="rounded-md border border-[var(--border-default)] px-2.5 py-2 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] min-h-[44px]"
                  >
                    later
                  </button>
                  {confirmDelete === task.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteTask(task.id);
                        setConfirmDelete(null);
                      }}
                      className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2.5 py-2 text-[10px] font-mono uppercase tracking-[0.1em] text-rose-300 min-h-[44px]"
                    >
                      confirm ✕
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(task.id)}
                      onBlur={() => setConfirmDelete((v) => (v === task.id ? null : v))}
                      aria-label={`Delete ${task.title}`}
                      className="rounded-md border border-[var(--border-default)] px-2.5 py-2 text-[10px] font-mono text-[var(--text-tertiary)] transition-colors hover:text-rose-300 min-h-[44px]"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
