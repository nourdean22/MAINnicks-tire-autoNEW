"use client";

/**
 * deck-triage.tsx — the airlock (Execution Deck §10.4).
 *
 * Raw intake never lands in "today": captures, Nick's pending
 * classifications, mission-less tasks, and rescue findings queue here
 * with one-tap verbs. Renders NOTHING when clear — quiet is the healthy
 * state (dark cockpit). The count is the whole-queue truth even when
 * rows are capped.
 *
 * 2026-09-16 · Visible Transformation: an eyebrow h2 with the queue count
 * in display type, hairline rows, 44px verbs; no card.
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

const VERB =
  "inline-flex min-h-[44px] shrink-0 items-center rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg";

export function DeckTriage({ triage, tasks, onEditTask, onSnoozeTask, onDeleteTask }: Props) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (triage.rows.length === 0) return null;

  const taskById = new Map(tasks.map((t) => [t.id, t]));

  return (
    <section aria-labelledby="triage-heading">
      <div className="flex items-end justify-between gap-3 border-b border-edge pb-3">
        <h2 id="triage-heading" className="vt-eyebrow text-fg-secondary">
          decide
        </h2>
        <span className="font-mono text-[12px] uppercase tracking-[0.12em] tabular-nums text-fg-tertiary">
          {triage.totalCount > triage.rows.length
            ? `showing ${triage.rows.length} of ${triage.totalCount}`
            : `${triage.totalCount} waiting`}
        </span>
      </div>

      <ul className="divide-y divide-edge">
        {triage.rows.map((row) => {
          const task = row.taskId ? taskById.get(row.taskId) : undefined;
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-[15px] text-fg">{row.title}</p>
                {row.detail && <p className="truncate text-[12px] text-fg-tertiary">{row.detail}</p>}
              </div>

              {row.kind === "capture" && (
                <Link href="/system/inbox" className={VERB}>
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
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => onEditTask(task)} className={VERB}>
                    file it
                  </button>
                  <button type="button" onClick={() => onSnoozeTask(task.id, nextWeekIso())} className={VERB}>
                    later
                  </button>
                  {confirmDelete === task.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteTask(task.id);
                        setConfirmDelete(null);
                      }}
                      className="inline-flex min-h-[44px] items-center rounded-control border border-rose-500/50 bg-rose-500/10 px-3 text-[13px] font-medium text-rose-300"
                    >
                      confirm ✕
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(task.id)}
                      onBlur={() => setConfirmDelete((v) => (v === task.id ? null : v))}
                      aria-label={`Delete ${task.title}`}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-edge-default font-mono text-[12px] text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-rose-300"
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
