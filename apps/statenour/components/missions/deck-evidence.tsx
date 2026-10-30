"use client";

/**
 * deck-evidence.tsx · done today + close the day.
 *
 * Receipts, not points: what got done, and a short shutdown that moves the
 * day's leftovers to tomorrow on purpose. Job 2026-10-23 (map F8): the
 * "nothing left" line used to render over a task list that was still loading
 * or had failed, and the "rolled" toast fired over failed snoozes. Now the
 * close step has three states (loading, error, ready) and reports only the
 * snoozes that were confirmed.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { MissionsDeck } from "@/lib/missions/deck";
import type { Task } from "@/components/actions/shared";
import { RESURFACE_PROMISE, tomorrowMorning } from "@/lib/missions/snooze-presets";
import { rollStragglers, rollSummary } from "@/lib/missions/roll-day";
import { ReadFailed } from "@/components/ui/read-failed";

type Props = {
  evidence: MissionsDeck["evidence"];
  tasks: Task[];
  /** The task list's read state: the close step never claims "nothing left" over an unread list. */
  tasksState: "loading" | "error" | "ready";
  /** Refetches today's tasks after a failed read. */
  onRetry: () => void;
  /** Live open task ids (deck.taskOrder): leftovers come from the same set the deck works from. */
  liveIds: Set<string>;
  onSnoozeTask: (taskId: string, untilIso: string, opts?: { quiet?: boolean }) => Promise<boolean>;
};

const VERB =
  "inline-flex min-h-[44px] items-center rounded-control border border-edge-default bg-content px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-60";

export function DeckEvidence({ evidence, tasks, tasksState, liveIds, onSnoozeTask, onRetry }: Props) {
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Leftovers: live, open, one-off tasks in flight or due today. Habits roll themselves.
  const stragglers = useMemo(() => {
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);
    return tasks.filter((t) => {
      if (!liveIds.has(t.id)) return false;
      if (t.status === "DOING") return true;
      const due = (t as { dueDate?: string | null }).dueDate;
      return Boolean(due && new Date(due) <= dayEnd);
    });
  }, [tasks, liveIds]);

  const rollAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const until = tomorrowMorning();
      const result = await rollStragglers(
        stragglers.map((t) => t.id),
        (id) => onSnoozeTask(id, until, { quiet: true }),
      );
      const summary = rollSummary(result, evidence.count);
      if (summary.ok) {
        toast.success(summary.text);
        setClosing(false);
      } else {
        toast.error(summary.text);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="evidence-heading">
      <div className="flex items-end justify-between gap-3 border-b border-edge pb-3">
        <h2 id="evidence-heading" className="vt-eyebrow text-fg-secondary">
          done today
        </h2>
        <span className="stat-number text-2xl leading-none text-fg">{evidence.count}</span>
      </div>

      {evidence.rows.length > 0 ? (
        <ul className="divide-y divide-edge">
          {evidence.rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-3 text-[15px]">
              <span className="min-w-0 truncate text-fg-secondary">{r.title}</span>
              {r.missionTitle && (
                <span className="ml-auto shrink-0 truncate font-mono text-[11px] text-fg-tertiary">{r.missionTitle}</span>
              )}
            </li>
          ))}
          {evidence.count > evidence.rows.length && (
            <li className="py-2 font-mono text-[11px] text-fg-tertiary">+{evidence.count - evidence.rows.length} more</li>
          )}
        </ul>
      ) : (
        <p className="py-3 text-[15px] text-fg-tertiary">Nothing finished yet today.</p>
      )}

      <div className="mt-2">
        <button type="button" onClick={() => setClosing((v) => !v)} aria-expanded={closing} className={VERB}>
          {closing ? "Not now" : "Close the day"}
        </button>
      </div>

      {closing && (
        <div className="mt-4 border-t border-edge pt-4" aria-live="polite">
          {tasksState === "loading" ? (
            <p className="text-[15px] text-fg-secondary">Reading today&apos;s tasks…</p>
          ) : tasksState === "error" ? (
            <ReadFailed onRetry={onRetry}>Could not read today&apos;s tasks, so nothing can be moved yet.</ReadFailed>
          ) : stragglers.length > 0 ? (
            <>
              <p className="text-[15px] text-fg">
                {stragglers.length} {stragglers.length === 1 ? "task" : "tasks"} from today {stragglers.length === 1 ? "is" : "are"} still
                open. Move {stragglers.length === 1 ? "it" : "them"} to tomorrow? Back {RESURFACE_PROMISE}.
              </p>
              <ul className="mt-2 space-y-1">
                {stragglers.slice(0, 5).map((t) => (
                  <li key={t.id} className="truncate text-[13px] text-fg-secondary">
                    {t.title}
                  </li>
                ))}
                {stragglers.length > 5 && (
                  <li className="font-mono text-[11px] text-fg-tertiary">+{stragglers.length - 5} more</li>
                )}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={rollAll} className={`${VERB} text-fg`}>
                  {busy ? "Moving…" : "Move to tomorrow"}
                </button>
                <button type="button" onClick={() => setClosing(false)} className={VERB}>
                  Leave them
                </button>
              </div>
            </>
          ) : (
            <p className="text-[15px] text-fg">Nothing from today is left open. {evidence.count} done.</p>
          )}
        </div>
      )}
    </section>
  );
}
