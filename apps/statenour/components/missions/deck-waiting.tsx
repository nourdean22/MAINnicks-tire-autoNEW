"use client";

/**
 * deck-waiting.tsx · blocked work and Nick's desk, inside the DECIDE sheet.
 *
 * Every waiting row ages visibly; rows handed to Nick offer a prefilled check
 * in. A WAITING task with no reason on file shows here too (map F12) and says
 * so. Unblock goes through the parent's confirm. Renders nothing when nothing
 * waits.
 */
import type { MissionsDeck } from "@/lib/missions/deck";
import type { Task } from "@/components/actions/shared";

type Props = {
  waiting: MissionsDeck["waiting"];
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onUnblock: (taskId: string) => void;
};

const VERB =
  "inline-flex min-h-[44px] shrink-0 items-center rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg";

export function DeckWaiting({ waiting, tasks, onEditTask, onUnblock }: Props) {
  if (waiting.length === 0) return null;
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const openNick = (title: string) => {
    window.dispatchEvent(
      new CustomEvent("statenour:open-nick", {
        // Prefill only: the operator sends it, never page load.
        detail: { pendingPrompt: `Status check on "${title}": what have you got so far?`, submitOnMount: false },
      }),
    );
  };

  return (
    <div>
      <h3 className="vt-eyebrow border-b border-edge pb-3 text-fg-secondary">waiting · {waiting.length}</h3>
      <ul className="divide-y divide-edge">
        {waiting.map((w) => {
          const task = taskById.get(w.id);
          const reason = w.delegatedToNick ? "with Nick" : w.waitingOn ? `waiting on ${w.waitingOn}` : "no reason on file";
          return (
            <li key={w.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-[15px] text-fg">{w.title}</p>
                <p className="truncate font-mono text-[11px] text-fg-tertiary">
                  {reason} · {w.ageDays === 0 ? "today" : `${w.ageDays}d`}
                </p>
              </div>
              {w.delegatedToNick ? (
                <button type="button" onClick={() => openNick(w.title)} className={VERB}>
                  Check in
                </button>
              ) : (
                task && (
                  <button type="button" onClick={() => onEditTask(task)} className={VERB}>
                    {w.waitingOn ? "Nudge" : "Add a reason"}
                  </button>
                )
              )}
              <button type="button" onClick={() => onUnblock(w.id)} className={VERB}>
                Unblock
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
