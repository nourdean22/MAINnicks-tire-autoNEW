"use client";

/**
 * deck-evidence.tsx — done today + Close the day (§10.9).
 *
 * Progress is receipts, not points: what actually got done, and a
 * 90-second shutdown that rolls the stragglers deliberately instead of
 * letting them ambush tomorrow morning. Skippable, never a wizard.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { MissionsDeck } from "@/lib/missions/deck";
import type { Task } from "@/components/actions/shared";

type Props = {
  evidence: MissionsDeck["evidence"];
  tasks: Task[];
  onSnoozeTask: (taskId: string, untilIso: string) => Promise<void> | void;
};

function tomorrow6amIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return d.toISOString();
}

export function DeckEvidence({ evidence, tasks, onSnoozeTask }: Props) {
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);

  // The stragglers: still open, due today or in flight — the set the
  // shutdown asks about. Habits roll themselves; they are excluded.
  const stragglers = useMemo(() => {
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);
    return tasks.filter((t) => {
      const loop = (t as { loopKind?: string }).loopKind;
      if (loop === "DAILY" || loop === "WEEKLY") return false;
      if (t.status !== "READY" && t.status !== "DOING" && t.status !== "INBOX") return false;
      if (t.status === "DOING") return true;
      const due = (t as { dueDate?: string | null }).dueDate;
      return Boolean(due && new Date(due) <= dayEnd);
    });
  }, [tasks]);

  const rollAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      for (const t of stragglers) {
        await onSnoozeTask(t.id, tomorrow6amIso());
      }
      toast.success(
        `Day closed — ${evidence.count} done, ${stragglers.length} rolled to tomorrow.`,
      );
      setClosing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="evidence-heading"
      className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] p-3 sm:p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="evidence-heading" className="text-sm font-semibold text-[var(--text-primary)]">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            done today
          </span>{" "}
          <span className="tabular-nums">({evidence.count})</span>
        </h2>
        <button
          type="button"
          onClick={() => setClosing((v) => !v)}
          className="rounded-md border border-[var(--border-default)] px-2.5 py-2 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] min-h-[44px]"
        >
          🌙 close the day
        </button>
      </div>

      {evidence.rows.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {evidence.rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-[12.5px]">
              <span aria-hidden className="text-[var(--gold)]">✓</span>
              <span className="min-w-0 truncate text-[var(--text-secondary)]">{r.title}</span>
              {r.missionTitle && (
                <span className="shrink-0 font-mono text-[10px] text-[var(--text-tertiary)]">
                  {r.missionTitle}
                </span>
              )}
            </li>
          ))}
          {evidence.count > evidence.rows.length && (
            <li className="font-mono text-[10px] text-[var(--text-tertiary)]">
              +{evidence.count - evidence.rows.length} more
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">Nothing finished yet today.</p>
      )}

      {closing && (
        <div className="mt-3 rounded-lg border border-[var(--gold)]/25 bg-[var(--gold)]/[0.04] p-3">
          {stragglers.length > 0 ? (
            <>
              <p className="text-[12.5px] text-[var(--text-primary)]">
                {stragglers.length} chosen-for-today {stragglers.length === 1 ? "task is" : "tasks are"} still
                open. Roll {stragglers.length === 1 ? "it" : "them"} to tomorrow 6am?
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {stragglers.slice(0, 5).map((t) => (
                  <li key={t.id} className="truncate text-[11px] text-[var(--text-secondary)]">
                    · {t.title}
                  </li>
                ))}
                {stragglers.length > 5 && (
                  <li className="font-mono text-[10px] text-[var(--text-tertiary)]">
                    +{stragglers.length - 5} more
                  </li>
                )}
              </ul>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={rollAll}
                  className="rounded-md bg-[var(--gold)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-black transition-colors hover:bg-[var(--gold)]/85 disabled:opacity-60 min-h-[44px]"
                >
                  {busy ? "rolling…" : "roll to tomorrow"}
                </button>
                <button
                  type="button"
                  onClick={() => setClosing(false)}
                  className="rounded-md border border-[var(--border-default)] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)] min-h-[44px]"
                >
                  leave them
                </button>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-[var(--text-primary)]">
              Clean close — nothing left from today. {evidence.count} done.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
