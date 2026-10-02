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
 *
 * 2026-09-16 · Visible Transformation: the hero spans the page above the
 * board. The task title is the one display line Missions shouts; the
 * start action sits in its own column on desktop. A gold rule, no card.
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

const RECORD_LABEL = "shrink-0 w-[9.5rem] pt-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary";

export function DeckNextMove({ nextMove, capacity, onStart, onPickDifferent }: Props) {
  const [alternatesOpen, setAlternatesOpen] = useState(false);

  if (!nextMove) {
    return (
      <section aria-labelledby="next-move-heading" className="border-l-2 border-edge pl-5 sm:pl-6">
        <h2 id="next-move-heading" className="vt-eyebrow text-gold/80">
          next move
        </h2>
        <p className="vt-verdict mt-3 max-w-[18ch]">Nothing is waiting on you.</p>
        <p className="mt-4 max-w-[48ch] text-lg text-fg-secondary">
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
      className="border-l-2 border-accent pl-5 sm:pl-6 xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-12"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="next-move-heading" className="vt-eyebrow text-fg-secondary">
            {kind === "resume" ? "resume" : "next move"}
          </h2>
          <span className="font-mono text-[12px] uppercase tracking-[0.12em] tabular-nums text-fg-tertiary">
            today: {capacity.chosenCount} chosen · {minutesLabel(capacity.chosenMinutes)}
          </span>
        </div>

        <p className="vt-verdict mt-3 max-w-[22ch]">{task.title}</p>

        {/* Quick-add falls back nextPhysicalAction = title; echoing the
            title twice reads as filler, so the line earns its row only
            when it says something the title doesn't. */}
        {task.nextPhysicalAction &&
          task.nextPhysicalAction.trim().toLowerCase() !== task.title.trim().toLowerCase() && (
            <p className="mt-4 max-w-[56ch] text-lg leading-relaxed text-fg-secondary">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">first · </span>
              {task.nextPhysicalAction}
            </p>
          )}

        {kind === "resume" && resumeNote && (
          <p className="mt-4 border-t border-edge pt-3 text-[15px] text-fg">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">you stopped at · </span>
            {resumeNote}
            {parkedAge && <span className="ml-2 font-mono text-[11px] text-fg-tertiary">{parkedAge}</span>}
          </p>
        )}

        {kind === "resume" && resumeRecord && (
          <dl className="mt-4 border-t border-edge pt-3 text-[15px] text-fg">
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
                <div key={k} className="flex gap-3 py-1">
                  <dt className={RECORD_LABEL}>{k}</dt>
                  <dd className="min-w-0">{v}</dd>
                </div>
              ))}
            {resumeRecord.evidenceLinks.length > 0 && (
              <div className="flex gap-3 py-1">
                <dt className={RECORD_LABEL}>Evidence</dt>
                <dd className="flex min-w-0 flex-wrap gap-2">
                  {resumeRecord.evidenceLinks.map((href) => (
                    <a
                      key={href}
                      href={href}
                      target={href.startsWith("/") ? undefined : "_blank"}
                      rel="noreferrer"
                      className="break-all underline decoration-edge-strong underline-offset-2"
                    >
                      {href.replace(/^https?:\/\//, "").slice(0, 60)}
                    </a>
                  ))}
                </dd>
              </div>
            )}
            <p className="mt-2 font-mono text-[11px] text-fg-tertiary">
              {parkedAge ?? "parked"} · a memory aid, not a plan — verify the last step before acting on it
            </p>
          </dl>
        )}

        <p className="mt-4 font-mono text-[12px] text-fg-tertiary">
          {task.missionTitle ? `${task.missionTitle} · ` : ""}
          {task.why.replace(/^picked because: /, "why: ")}
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-3 xl:mt-0 xl:justify-end">
        <button
          type="button"
          onClick={() => onStart(task.id)}
          className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-control bg-accent px-6 text-[15px] font-semibold text-[var(--text-inverse)] transition-colors duration-[var(--motion-state)] hover:bg-accent-hover"
        >
          ▶ {kind === "resume" ? "Resume" : "Start"} · {minutesLabel(task.effortMinutes)}
        </button>
        {alternates.length > 0 && (
          <button
            type="button"
            aria-expanded={alternatesOpen}
            onClick={() => setAlternatesOpen((v) => !v)}
            className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-control border border-edge-default bg-content px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
          >
            Different move {alternatesOpen ? "▴" : "▾"}
          </button>
        )}

        {alternatesOpen && alternates.length > 0 && (
          <ul className="divide-y divide-edge border-t border-edge">
            {alternates.map((alt) => (
              <li key={alt.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[15px] text-fg">{alt.title}</p>
                  <p className="truncate font-mono text-[11px] text-fg-tertiary">
                    {alt.why.replace(/^picked because: /, "")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onPickDifferent(alt.id)}
                  className="inline-flex min-h-[44px] shrink-0 items-center rounded-control border border-edge-default bg-content px-3 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
                >
                  Make this the move
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
