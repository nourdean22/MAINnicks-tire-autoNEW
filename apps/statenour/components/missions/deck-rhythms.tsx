"use client";

/**
 * deck-rhythms.tsx — habits off the board (Execution Deck §10.7).
 *
 * DAILY/WEEKLY loops are practices, not attention claims: they used to
 * sit as board rows with per-task 🔥 streaks whose lazy reset let a
 * broken streak read "🔥18d" indefinitely. This strip measures kindly
 * instead — a rolling window ("6 of last 7") degrades gradually and
 * never snaps to zero. Evidence: intact streaks motivate, visibly
 * broken ones suppress below baseline (Silverman & Barasch, JCR 2023).
 */
import type { MissionsDeck } from "@/lib/missions/deck";

type Props = {
  rhythms: MissionsDeck["rhythms"];
  onComplete: (taskId: string) => void;
};

export function DeckRhythms({ rhythms, onComplete }: Props) {
  if (rhythms.length === 0) return null;

  return (
    <section
      aria-labelledby="rhythms-heading"
      className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] p-3 sm:p-4"
    >
      <h2
        id="rhythms-heading"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]"
      >
        rhythms
      </h2>
      <ul className="mt-2 space-y-1">
        {rhythms.map((r) => (
          <li key={r.id} className="flex items-center gap-3">
            <button
              type="button"
              disabled={r.doneToday}
              onClick={() => onComplete(r.id)}
              aria-label={r.doneToday ? `${r.title} — done today` : `Complete ${r.title}`}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center"
            >
              <span
                aria-hidden
                className={
                  r.doneToday
                    ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--gold)] text-[11px] font-bold text-black"
                    : "inline-block h-5 w-5 rounded-full border border-[var(--border-default)] transition-colors hover:border-[var(--gold)]/60"
                }
              >
                {r.doneToday ? "✓" : ""}
              </span>
            </button>
            <span
              className={
                r.doneToday
                  ? "min-w-0 flex-1 truncate text-[13px] text-[var(--text-tertiary)] line-through decoration-[var(--border-default)]"
                  : "min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]"
              }
            >
              {r.title}
            </span>
            {r.windowOf > 0 && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-tertiary)]">
                {r.windowDone} of {r.windowOf}
                {r.loopKind === "WEEKLY" ? " · weekly" : ""}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
