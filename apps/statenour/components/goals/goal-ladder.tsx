/**
 * The milestone ladder on a goal card (job 2026-11-02-nour-os-interconnect W5): the linked mission's
 * plan phases, read on the server (lib/stats/goals-page.ts missionPhaseLadder). Done carries a check,
 * the current phase is the gold milestone with the word "now", the rest a hollow ring. One wrapping
 * line, so a five-phase plan costs one or two lines at phone width.
 */
import type { LadderPhase } from "@/lib/stats/goals-page";

/** Phases shown on a card; the rest collapse into "+N more". */
export const LADDER_PHASE_CAP = 6;

/** `phases` null = the missions read failed: say so, never render it as "no plan". */
export function GoalLadder({ phases }: { phases: readonly LadderPhase[] | null }) {
  if (phases === null) return <p className="mt-1.5 font-mono text-[11px] text-amber-300">Milestones couldn&apos;t load</p>;
  if (phases.length === 0) return null;
  const shown = phases.slice(0, LADDER_PHASE_CAP);
  const more = phases.length - shown.length;
  const done = phases.filter((p) => p.done).length;
  return (
    <div className="mt-1.5 space-y-0.5">
      <p className="font-mono text-[11px] text-fg-tertiary">
        Milestones · {done} of {phases.length} done
      </p>
      <ol aria-label="Milestones" className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
        {shown.map((p, i) => (
          <li
            key={i} // two phases may share a name
            aria-current={p.current ? "step" : undefined}
            className={p.done ? "text-emerald-300" : p.current ? "font-medium text-accent" : "text-fg-tertiary"}
          >
            {p.done ? `✓ ${p.name}` : p.current ? `now: ${p.name}` : `◌ ${p.name}`}
          </li>
        ))}
        {more > 0 && <li className="font-mono text-[11px] text-fg-tertiary">+{more} more</li>}
      </ol>
    </div>
  );
}
