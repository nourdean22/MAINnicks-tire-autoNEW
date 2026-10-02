"use client";

/**
 * deck-evidence.tsx — done today + Close the day (§10.9).
 *
 * Progress is receipts, not points: what actually got done, and a
 * 90-second shutdown that rolls the stragglers deliberately instead of
 * letting them ambush tomorrow morning. Skippable, never a wizard.
 *
 * 2026-09-16 · Visible Transformation: the rail's evidence column — an
 * eyebrow h2 with the count in display type, hairline rows, and the
 * close-the-day prompt as a section under a rule instead of a card in a
 * card.
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

const VERB =
  "inline-flex min-h-[44px] items-center rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg";

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
              <span aria-hidden className="text-emerald-300">✓</span>
              <span className="min-w-0 truncate text-fg-secondary">{r.title}</span>
              {r.missionTitle && (
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
                  {r.missionTitle}
                </span>
              )}
            </li>
          ))}
          {evidence.count > evidence.rows.length && (
            <li className="py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
              +{evidence.count - evidence.rows.length} more
            </li>
          )}
        </ul>
      ) : (
        <p className="py-3 text-[15px] text-fg-tertiary">Nothing finished yet today.</p>
      )}

      <div className="mt-2">
        <button type="button" onClick={() => setClosing((v) => !v)} className={VERB}>
          🌙 close the day
        </button>
      </div>

      {closing && (
        <div className="mt-4 border-t border-edge pt-4">
          {stragglers.length > 0 ? (
            <>
              <p className="text-[15px] text-fg">
                {stragglers.length} chosen-for-today {stragglers.length === 1 ? "task is" : "tasks are"} still
                open. Roll {stragglers.length === 1 ? "it" : "them"} to tomorrow 6am?
              </p>
              <ul className="mt-2 space-y-1">
                {stragglers.slice(0, 5).map((t) => (
                  <li key={t.id} className="truncate text-[13px] text-fg-secondary">
                    · {t.title}
                  </li>
                ))}
                {stragglers.length > 5 && (
                  <li className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
                    +{stragglers.length - 5} more
                  </li>
                )}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={rollAll}
                  className="inline-flex min-h-[44px] items-center rounded-control border border-edge-default bg-content px-4 text-[13px] font-medium text-fg transition-colors duration-[var(--motion-state)] hover:border-edge-strong disabled:opacity-60"
                >
                  {busy ? "rolling…" : "roll to tomorrow"}
                </button>
                <button type="button" onClick={() => setClosing(false)} className={VERB}>
                  leave them
                </button>
              </div>
            </>
          ) : (
            <p className="text-[15px] text-fg">
              Clean close — nothing left from today. {evidence.count} done.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
