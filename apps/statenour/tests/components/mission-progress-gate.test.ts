/**
 * A completion percentage is a claim that the thing can be completed.
 *
 * THE LIVE ARTEFACT, measured against prod 2026-08-23. MissionCard rendered a
 * "79%" chip and a progress bar on GENERAL BUSINESS & NICKS TIRE — 26 of 33
 * tasks done. That mission has no deadline, no completionCriteria, and its
 * sibling catch-alls carry a successMetric that reads, verbatim:
 *
 *     "Catch-all for business tasks with no specific project."
 *
 * A life-area bucket has no 100%. Worse, the figure was done/(done+open) over
 * every task ever filed, so CAPTURING a task lowered it: the two things the
 * operator is supposed to do moved one number in opposite directions, and a
 * bucket working exactly as intended sat near 79% forever, reading as
 * "nearly finished".
 *
 * MEASURED POPULATION (all 9 live missions, 2026-08-23):
 *   · completionCriteria populated:  0 of 9
 *   · deadline populated:            2 of 9 — both already COMPLETE / KILLED
 *   · successMetric populated:       6 of 9 — four of those six say the
 *                                    mission is a catch-all with no project
 * So the three ACTIVE missions the operator lives in declare no end state, and
 * the percentage correctly disappears from all of them.
 *
 * PRECEDENT. wave-AA-audit already hid the "0%" chip on task-less missions as
 * "a misleading anchor on fresh missions". Same judgment; this is the general
 * case rather than the boundary case.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { missionHasEndState } from "@/lib/services/mission-helpers";
import { derivedMetrics } from "@/components/missions/mission-card";
import type { Project, Task } from "@/components/actions/shared";

const mission = (over: Partial<Project> = {}): Project =>
  ({ id: "m1", title: "GENERAL BUSINESS & NICKS TIRE", status: "ACTIVE", ...over }) as Project;

const tasks = (done: number, open: number): Task[] => [
  ...Array.from({ length: done }, (_, i) => ({ id: `d${i}`, status: "DONE" }) as Task),
  ...Array.from({ length: open }, (_, i) => ({ id: `o${i}`, status: "READY" }) as Task),
];

describe("missionHasEndState · what counts as a finish", () => {
  it("THE ARTEFACT: the real bucket, exactly as prod holds it, has no end state", () => {
    expect(missionHasEndState(mission())).toBe(false);
  });

  it("POSITIVE CONTROL: a deadline is an end state", () => {
    // Without this, a predicate hardcoded to `false` would satisfy every
    // negative assertion here and silently kill the bar for real projects too.
    expect(missionHasEndState(mission({ deadline: "2026-09-01T00:00:00Z" }))).toBe(true);
  });

  it("completionCriteria ALONE is an end state — the self-restoring property", () => {
    // This is the assertion that stops the gate from decaying into a
    // deadline-only proxy. Today 0 of 9 missions carry criteria, so a
    // deadline-only implementation would be indistinguishable from this one —
    // and would silently fail the first time the operator declares criteria
    // without a date. That is the blind-instrument shape, pre-empted.
    expect(missionHasEndState(mission({ completionCriteria: { must: "ship it" } }))).toBe(true);
    expect(missionHasEndState(mission({ completionCriteria: "revenue back to $18k" }))).toBe(true);
  });

  it("empty JSON shapes are not a declaration", () => {
    for (const v of [null, undefined, "", "   ", {}, []]) {
      expect(missionHasEndState(mission({ completionCriteria: v })), `${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("successMetric does NOT count — it is the field that says there is no project", () => {
    // Populated on 6 of 9; four of those values are the catch-all sentence.
    // Gating on it would put a completion bar on exactly the missions that
    // declare they have no completion.
    const withMetric = mission({
      // @ts-expect-error — deliberately passing a field the predicate must ignore
      successMetric: "Catch-all for business tasks with no specific project.",
    });
    expect(missionHasEndState(withMetric)).toBe(false);
  });
});

describe("derivedMetrics · what the card header shows", () => {
  it("THE ARTEFACT: 26 done / 7 open on a bucket reports no end state", () => {
    const m = derivedMetrics(mission(), tasks(26, 7));
    expect(m.progress).toBe(79); // the number itself is still computed correctly
    expect(m.hasEndState, "…but there is nothing for 79% to be 79% OF").toBe(false);
    expect(m.openTasks).toHaveLength(7);
    expect(m.doneTasks).toHaveLength(26);
  });

  it("POSITIVE CONTROL: the same tasks under a real project keep the percentage", () => {
    const m = derivedMetrics(mission({ deadline: "2026-09-01T00:00:00Z" }), tasks(26, 7));
    expect(m.hasEndState).toBe(true);
    expect(m.progress).toBe(79);
  });

  it("the perverse incentive, stated as a test: capturing a task lowers progress", () => {
    // Not a bug in the arithmetic — the arithmetic is right. It is the reason a
    // ratio is the wrong instrument for a bucket, and it is why the open count
    // replaces it: 7 open goes UP when you capture, which is honest.
    const before = derivedMetrics(mission(), tasks(26, 7)).progress;
    const after = derivedMetrics(mission(), tasks(26, 8)).progress;
    expect(after).toBeLessThan(before);
  });
});

describe("the gate is wired — a computed value nobody reads is not a fix", () => {
  const src = readFileSync(
    resolve(process.cwd(), "components/missions/mission-card.tsx"),
    "utf8",
  );

  it("the percentage chip is gated on hasEndState", () => {
    expect(src).toMatch(/hasEndState \? \(/);
    expect(src, "the bucket branch must show the open count").toMatch(
      /\{openTasks\.length\} open/,
    );
  });

  it("the progress BAR is gated too — hiding one and not the other is half a fix", () => {
    expect(src).toMatch(/openTasks\.length \+ doneTasks\.length > 0 && hasEndState &&/);
  });

  it("hasEndState is destructured from derivedMetrics, not recomputed inline", () => {
    // Tolerant of the useMemo wrapper the component actually uses, but still
    // asserts the linkage: the rendered flag comes from the function under
    // test above, so the behavioural assertions describe the real header.
    expect(src).toMatch(/const \{[^}]*hasEndState[^}]*\} =[\s\S]{0,90}derivedMetrics\(mission, tasks\)/);
  });
});
