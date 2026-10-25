"use client";

/**
 * Learning-velocity scoreboard (Wave V #5), on the Brain Health tab since wave D (2026-10-24): it is a
 * reading about how the brain is doing, not a belief to correct, so it left the Memory tab.
 *
 * `measureLearningVelocity()` returns a digest exposed via `trpc.journal.learningVelocity`.
 *
 * 2026-09-02 metrics-honesty pass. Every number on this card used to misstate its own window:
 *   - the headline read "brain +N% vs 30d ago" from a composite with no 30-day term in it; three of
 *     its five inputs were all-time levels. The composite is deleted (lib/brain/learning-velocity.ts);
 *     the headline is a real 30d-vs-prior-30d change in memories created, and it says "memories".
 *   - the four cells mixed a 7d count, two 30d counts and one LIFETIME total under one "velocity"
 *     label. Each cell now carries its own window; the contradictions cell is a real 30d slice.
 *   - health was rendered "/100" even when a dimension was unmeasurable. It renders out of the max
 *     actually available this run.
 */

import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { ReadStateNote } from "@/components/ui/read-state-note";
import { readState } from "@/lib/query-state";
import { ReadingUnavailable, StaleNote } from "@/components/brain/brain-fold";

export function LearningVelocityScoreboard() {
  const velocityQ = trpc.journal.learningVelocity.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  const { data, isError } = velocityQ;
  // This digest has no empty state (it always returns numbers), so the only reason data is missing
  // is that the read failed or is paused offline. Say so. The failed line is for NO data: with cached
  // data a failed refresh keeps the numbers and the stale note says they may be old.
  if (isError && !data) return <ReadingUnavailable label="Learning velocity" />;
  if (!data) return readState(velocityQ) === "offline" ? <ReadStateNote state="offline" label="Learning velocity" /> : null;
  const pct = data.memoryPctChange30d;
  return (
    <section aria-label="learning velocity" className="space-y-2 border-t border-edge pt-4">
      <StaleNote q={velocityQ} label="Learning velocity" />
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-medium text-fg">Learning velocity</h3>
        <p
          className={cn(
            "text-[13px] font-mono tabular-nums",
            pct === null ? "text-fg-tertiary" : pct > 0 ? "text-emerald-300" : pct < 0 ? "text-rose-300" : "text-fg-tertiary",
          )}
        >
          {/* pct === null means the prior 30-day window held zero memories, so a percent change is
              undefined. Say that, rather than rendering a 0% that would read as "no change". */}
          {pct === null
            ? `memories ${data.memoriesLast30d} in 30d · no prior window to compare`
            : `memories ${pct > 0 ? "+" : ""}${pct}% vs prior 30d`}
          {" · health "}
          {data.healthScore}/{data.healthScoreMax}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 font-mono text-[13px] sm:grid-cols-2">
        <ScoreboardCell label="memories · 7d" value={data.memoriesThisWeek} delta={data.memoriesDelta} />
        {/* "wisdom rows", not "wisdom promotions": this counts rows created in the wisdom category,
            which a distiller run or a batch of chat scrapes also lands in. */}
        <ScoreboardCell label="wisdom rows · 30d" value={data.wisdomCreated30d} delta={null} />
        <ScoreboardCell label="connections · 30d" value={data.newConnections30d} delta={null} />
        <ScoreboardCell label="contradictions resolved · 30d" value={data.contradictionsResolved30d} delta={null} />
      </div>
    </section>
  );
}

function ScoreboardCell({ label, value, delta }: { label: string; value: number; delta: number | null }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="truncate text-fg-tertiary">{label}</span>
      <span className="tabular-nums text-fg">{value}</span>
      {delta !== null && delta !== 0 && (
        <span className={cn("tabular-nums", delta > 0 ? "text-emerald-300" : "text-rose-300")}>
          ({delta > 0 ? "+" : ""}
          {delta})
        </span>
      )}
    </div>
  );
}
