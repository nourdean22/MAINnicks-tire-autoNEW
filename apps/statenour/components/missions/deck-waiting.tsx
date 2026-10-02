"use client";

/**
 * deck-waiting.tsx — blocked work + Nick's desk (§10.8).
 *
 * Every waitingOn row ages visibly; rows handed to Nick show as
 * delegated with a one-tap way to open the pane and check. Renders
 * nothing when nothing waits — quiet is healthy.
 *
 * 2026-09-16 · Visible Transformation: the rail's WAITING / BLOCKED
 * column — an eyebrow h2 and hairline rows, no card; the violet marker is
 * gone (program §5.2: AI attribution is a mark, not a hue); every verb is
 * a 44px target.
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
        // PREFILL-ONLY ($0 doctrine): the operator sends it, never page load.
        detail: { pendingPrompt: `Status check: "${title}" — what have you got so far?`, submitOnMount: false },
      }),
    );
  };

  return (
    <section aria-labelledby="waiting-heading">
      <div className="flex items-end justify-between gap-3 border-b border-edge pb-3">
        <h2 id="waiting-heading" className="vt-eyebrow text-fg-secondary">
          waiting · blocked
        </h2>
        <span className="stat-number text-2xl leading-none text-amber-300">{waiting.length}</span>
      </div>
      <ul className="divide-y divide-edge">
        {waiting.map((w) => {
          const task = taskById.get(w.id);
          return (
            <li key={w.id} className="flex flex-wrap items-center gap-3 py-3">
              <span aria-hidden className="shrink-0 font-mono text-[12px] text-fg-tertiary">
                {w.delegatedToNick ? "◐" : "⏸"}
              </span>
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-[15px] text-fg">{w.title}</p>
                <p className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
                  {w.delegatedToNick ? "with Nick" : `waiting on ${w.waitingOn}`} ·{" "}
                  {w.ageDays === 0 ? "today" : `${w.ageDays}d`}
                </p>
              </div>
              {w.delegatedToNick ? (
                <button type="button" onClick={() => openNick(w.title)} className={VERB}>
                  Check in
                </button>
              ) : (
                task && (
                  <button type="button" onClick={() => onEditTask(task)} className={VERB}>
                    Nudge
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
    </section>
  );
}
