"use client";

/**
 * deck-waiting.tsx — blocked work + Nick's desk (§10.8).
 *
 * Every waitingOn row ages visibly; rows handed to Nick show as
 * delegated with a one-tap way to open the pane and check. Renders
 * nothing when nothing waits — quiet is healthy.
 */
import type { MissionsDeck } from "@/lib/missions/deck";
import type { Task } from "@/components/actions/shared";

type Props = {
  waiting: MissionsDeck["waiting"];
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onUnblock: (taskId: string) => void;
};

export function DeckWaiting({ waiting, tasks, onEditTask, onUnblock }: Props) {
  if (waiting.length === 0) return null;
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const openNick = (title: string) => {
    window.dispatchEvent(
      new CustomEvent("statenour:open-nick", {
        // PREFILL-ONLY ($0 doctrine): the operator sends it, never page load.
        detail: { pendingPrompt: `Status check: "${title}" — what have you got so far?`, submitOnMount: false },
      }),
    );
  };

  return (
    <section
      aria-labelledby="waiting-heading"
      className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] p-3 sm:p-4"
    >
      <h2
        id="waiting-heading"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]"
      >
        waiting
      </h2>
      <ul className="mt-2 space-y-1.5">
        {waiting.map((w) => {
          const task = taskById.get(w.id);
          return (
            <li key={w.id} className="flex items-center gap-2">
              <span aria-hidden className="shrink-0 text-[12px] text-violet-300/80">
                {w.delegatedToNick ? "◐" : "⏸"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-[var(--text-primary)]">{w.title}</p>
                <p className="truncate font-mono text-[10px] text-[var(--text-tertiary)]">
                  {w.delegatedToNick ? "with Nick" : `waiting on ${w.waitingOn}`} ·{" "}
                  {w.ageDays === 0 ? "today" : `${w.ageDays}d`}
                </p>
              </div>
              {w.delegatedToNick ? (
                <button
                  type="button"
                  onClick={() => openNick(w.title)}
                  className="shrink-0 rounded-md border border-[var(--border-default)] px-2.5 py-2 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] min-h-[44px]"
                >
                  check in
                </button>
              ) : (
                task && (
                  <button
                    type="button"
                    onClick={() => onEditTask(task)}
                    className="shrink-0 rounded-md border border-[var(--border-default)] px-2.5 py-2 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] min-h-[44px]"
                  >
                    nudge
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => onUnblock(w.id)}
                className="shrink-0 rounded-md border border-[var(--border-default)] px-2.5 py-2 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/40 hover:text-[var(--gold)] min-h-[44px]"
              >
                unblock
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
