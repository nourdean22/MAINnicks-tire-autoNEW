"use client";

/**
 * deck-next-move.tsx — the Execution Deck hero: ONE decided action.
 *
 * Replaces TopMissionToday (whose only filter was status==="ACTIVE", so
 * the GENERAL BUSINESS catch-all owned the hero structurally, and whose
 * CTA pointed at an anchor id that doesn't exist) and the on-page AI
 * morning brief (Home's server-compiled brief is the one brief).
 *
 * Server picks the move (task.deck — scoreTaskPriority is the only
 * ordering brain); this component states it, says why in the scorer's
 * own words, and starts it. No fabricated confidence, no percentages.
 */
import { resumeAgeLabel } from "@/lib/missions/resume-record";
import { useState } from "react";
import type { MissionsDeck } from "@/lib/missions/deck";

type Props = {
  nextMove: NonNullable<MissionsDeck>["nextMove"];
  capacity: { chosenMinutes: number; chosenCount: number };
  onStart: (taskId: string) => void;
  onPickDifferent: (taskId: string) => void;
};

function minutesLabel(mins: number): string {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins} min`;
}

export function DeckNextMove({ nextMove, capacity, onStart, onPickDifferent }: Props) {
  const [alternatesOpen, setAlternatesOpen] = useState(false);

  if (!nextMove) {
    return (
      <section
        aria-labelledby="next-move-heading"
        className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-base)] p-4 sm:p-5"
      >
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--gold)]/80">next move</p>
        <h2 id="next-move-heading" className="mt-2 text-base font-semibold text-[var(--text-primary)]">
          Nothing is waiting on you.
        </h2>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          Capture something below, or close the day.
        </p>
      </section>
    );
  }

  const { task, kind, alternates, resumeNote, resumeRecord, parkedAt } = nextMove;
  const parkedAge = resumeAgeLabel(parkedAt);

  return (
    <section
      aria-labelledby="next-move-heading"
      className="rounded-2xl border border-[var(--gold)]/40 bg-[var(--gold)]/[0.04] p-4 sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--gold)]">
          {kind === "resume" ? "resume" : "next move"}
        </p>
        <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
          today: {capacity.chosenCount} chosen · {minutesLabel(capacity.chosenMinutes)}
        </span>
      </div>

      <h2
        id="next-move-heading"
        className="mt-2 text-[19px] font-semibold leading-snug tracking-tight text-[var(--text-primary)]"
      >
        {task.title}
      </h2>
      {/* Quick-add falls back nextPhysicalAction = title; echoing the
          title twice reads as filler, so the line earns its row only
          when it says something the title doesn't. */}
      {task.nextPhysicalAction &&
        task.nextPhysicalAction.trim().toLowerCase() !== task.title.trim().toLowerCase() && (
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            First: {task.nextPhysicalAction}
          </p>
        )}
      {kind === "resume" && resumeNote && (
        <p className="mt-2 rounded-lg border border-[var(--gold)]/20 bg-[var(--bg-base)]/60 px-3 py-2 text-[13px] text-[var(--text-primary)]">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--gold)]/80">
            you stopped at ·{" "}
          </span>
          {resumeNote}
          {parkedAge && <span className="ml-2 font-mono text-[10px] text-[var(--text-tertiary)]">{parkedAge}</span>}
        </p>
      )}
      {kind === "resume" && resumeRecord && (
        <dl className="mt-2 rounded-lg border border-[var(--gold)]/20 bg-[var(--bg-base)]/60 px-3 py-2 text-[13px] text-[var(--text-primary)]">
          {(
            [
              ["Intended outcome", resumeRecord.intendedOutcome],
              ["Last verified step", resumeRecord.lastVerifiedStep],
              ["Open question", resumeRecord.openQuestion],
              ["Next physical action", resumeRecord.nextPhysicalAction],
            ] as const
          )
            .filter(([, v]) => !!v)
            .map(([k, v]) => (
              <div key={k} className="flex gap-2 py-0.5">
                <dt className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--gold)]/80 pt-0.5 w-[9.5rem]">{k}</dt>
                <dd className="min-w-0">{v}</dd>
              </div>
            ))}
          {resumeRecord.evidenceLinks.length > 0 && (
            <div className="flex gap-2 py-0.5">
              <dt className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--gold)]/80 pt-0.5 w-[9.5rem]">Evidence</dt>
              <dd className="min-w-0 flex flex-wrap gap-2">
                {resumeRecord.evidenceLinks.map((href) => (
                  <a
                    key={href}
                    href={href}
                    target={href.startsWith("/") ? undefined : "_blank"}
                    rel="noreferrer"
                    className="underline decoration-[var(--gold)]/40 underline-offset-2 break-all"
                  >
                    {href.replace(/^https?:\/\//, "").slice(0, 60)}
                  </a>
                ))}
              </dd>
            </div>
          )}
          <p className="mt-1 font-mono text-[10px] text-[var(--text-tertiary)]">
            {parkedAge ?? "parked"} · a memory aid, not a plan — verify the last step before acting on it
          </p>
        </dl>
      )}

      <p className="mt-2 text-[11px] font-mono text-[var(--text-tertiary)]">
        {task.missionTitle ? `${task.missionTitle} · ` : ""}
        {task.why.replace(/^picked because: /, "why: ")}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onStart(task.id)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--gold)] px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-black transition-colors hover:bg-[var(--gold)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)]"
        >
          ▶ {kind === "resume" ? "Resume" : "Start"} {minutesLabel(task.effortMinutes)}
        </button>
        {alternates.length > 0 && (
          <button
            type="button"
            aria-expanded={alternatesOpen}
            onClick={() => setAlternatesOpen((v) => !v)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-[var(--border-default)] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Different move {alternatesOpen ? "▴" : "▾"}
          </button>
        )}
      </div>

      {alternatesOpen && alternates.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-[var(--border-default)] pt-3">
          {alternates.map((alt) => (
            <li key={alt.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] text-[var(--text-primary)]">{alt.title}</p>
                <p className="truncate text-[10px] font-mono text-[var(--text-tertiary)]">
                  {alt.why.replace(/^picked because: /, "")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onPickDifferent(alt.id)}
                className="shrink-0 rounded-md border border-[var(--border-default)] px-2.5 py-2 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/40 hover:text-[var(--gold)] min-h-[44px]"
              >
                make this the move
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
