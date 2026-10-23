"use client";

/**
 * deck-decide.tsx · DECIDE folded to one count line.
 *
 * The airlock used to open as a queue of up to 87 rows at the top of the page,
 * 75 of them in a KILLED mission (job 2026-10-23, maps F1, F2, D1). Now the
 * page shows one line with the true counts; tapping it opens the queue, the
 * Waiting rows, and the tasks that sit in closed missions. Those last ones are
 * counted and listed for review, never worked from and never bulk-changed:
 * what happens to them is the operator's call, one task at a time.
 */
import { useState } from "react";
import type { MissionsDeck } from "@/lib/missions/deck";
import type { Task } from "@/components/actions/shared";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { DeckTriage } from "@/components/missions/deck-triage";
import { DeckWaiting } from "@/components/missions/deck-waiting";

type Props = {
  triage: MissionsDeck["triage"];
  waiting: MissionsDeck["waiting"];
  closed: MissionsDeck["closed"];
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onSnoozeTask: (taskId: string, untilIso: string) => Promise<boolean>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onUnblock: (taskId: string) => void;
  /** deck.unmeasured: a failed captures or rescue read makes the DECIDE count unknown, never 0. */
  unmeasured: string[];
};

const STATE_WORD: Record<MissionsDeck["closed"]["rows"][number]["missionState"], string> = {
  KILLED: "stopped",
  COMPLETE: "finished",
  PAUSED: "paused",
  DELETED: "deleted",
};

const CLOSED_FIRST_PAGE = 25;

const VERB =
  "inline-flex min-h-[44px] shrink-0 items-center rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg";

export function DeckDecide({ triage, waiting, closed, tasks, onEditTask, onSnoozeTask, onDeleteTask, onUnblock, unmeasured }: Props) {
  const [open, setOpen] = useState(false);
  const [showAllClosed, setShowAllClosed] = useState(false);
  const { confirm, dialog } = useConfirmDialog();

  const total = triage.totalCount + waiting.length;
  const unread = ["captures", "rescue"].filter((s) => unmeasured.includes(s));
  if (total === 0 && closed.count === 0 && unread.length === 0) return null;

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const parts = [
    unread.length > 0
      ? `${unread.map((s) => s[0].toUpperCase() + s.slice(1)).join(" and ")} not read, count unknown`
      : `${triage.totalCount} to decide`,
    ...(waiting.length > 0 ? [`${waiting.length} waiting`] : []),
    ...(closed.count > 0 ? [`${closed.count} in closed missions`] : []),
  ];

  const askDelete = async (taskId: string) => {
    const ok = await confirm({ title: "Delete this task?", body: "It leaves every list on this page.", confirmLabel: "Delete", tone: "danger" });
    if (ok) await onDeleteTask(taskId);
  };
  const askUnblock = async (taskId: string) => {
    const ok = await confirm({ title: "Mark this unblocked?", body: "It goes back to the board as ready.", confirmLabel: "Unblock" });
    if (ok) onUnblock(taskId);
  };

  const closedRows = showAllClosed ? closed.rows : closed.rows.slice(0, CLOSED_FIRST_PAGE);

  return (
    <section aria-labelledby="decide-heading">
      {dialog}
      <div className="flex items-center justify-between gap-3 border-b border-edge pb-3">
        <h2 id="decide-heading" className="vt-eyebrow text-fg-secondary">
          decide
        </h2>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="decide-sheet" className={VERB}>
          {open ? "Close" : "Open"}
        </button>
      </div>
      <p className="pt-3 text-[15px] text-fg-secondary">{parts.join(" · ")}</p>

      {open && (
        <div id="decide-sheet" className="mt-4 space-y-8">
          <DeckTriage triage={triage} tasks={tasks} onEditTask={onEditTask} onSnoozeTask={onSnoozeTask} onDeleteTask={askDelete} incomplete={unread.length > 0} />

          <DeckWaiting waiting={waiting} tasks={tasks} onEditTask={onEditTask} onUnblock={(id) => void askUnblock(id)} />

          {closed.count > 0 && (
            <div>
              <h3 className="vt-eyebrow border-b border-edge pb-3 text-fg-secondary">in closed missions · {closed.count}</h3>
              <p className="py-3 text-[13px] text-fg-tertiary">
                These tasks sit in missions that are finished, stopped, paused or deleted, so nothing above picks them.
                File one into a live mission to bring it back, or delete it.
              </p>
              <ul className="divide-y divide-edge">
                {closedRows.map((row) => {
                  const task = taskById.get(row.id);
                  return (
                    <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="truncate text-[15px] text-fg">{row.title}</p>
                        <p className="font-mono text-[11px] text-fg-tertiary">mission {STATE_WORD[row.missionState]}</p>
                      </div>
                      {task && (
                        <button type="button" onClick={() => onEditTask(task)} className={VERB}>
                          File it
                        </button>
                      )}
                      <button type="button" onClick={() => void askDelete(row.id)} aria-label={`Delete ${row.title}`} className={VERB}>
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
              {(closed.rows.length > CLOSED_FIRST_PAGE || closed.count > closed.rows.length) && (
                <div className="pt-2">
                  {closed.rows.length > CLOSED_FIRST_PAGE && (
                    <button type="button" onClick={() => setShowAllClosed((v) => !v)} className={VERB}>
                      {showAllClosed ? "Show fewer" : `Show all ${closed.rows.length}`}
                    </button>
                  )}
                  {closed.count > closed.rows.length && (
                    <p className="pt-2 font-mono text-[11px] text-fg-tertiary">
                      {closed.count - closed.rows.length} more not listed here
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
