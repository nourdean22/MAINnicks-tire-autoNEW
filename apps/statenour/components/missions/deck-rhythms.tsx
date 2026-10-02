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
      className="rounded-surface border border-edge-subtle bg-content p-3 sm:p-4"
    >
      <h2
        id="rhythms-heading"
        className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary"
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
                    ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-[11px] font-bold text-[var(--text-inverse)]"
                    : "inline-block h-5 w-5 rounded-full border border-edge-default transition-colors duration-[var(--motion-state)] hover:border-edge-strong"
                }
              >
                {r.doneToday ? "✓" : ""}
              </span>
            </button>
            <span
              className={
                r.doneToday
                  ? "min-w-0 flex-1 truncate text-[13px] text-fg-tertiary line-through decoration-edge-default"
                  : "min-w-0 flex-1 truncate text-[13px] text-fg"
              }
            >
              {r.title}
            </span>
            {r.windowOf > 0 && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-tertiary">
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
