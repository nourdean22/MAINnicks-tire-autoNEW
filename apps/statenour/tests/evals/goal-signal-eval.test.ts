/**
 * Goals-system eval (job 2026-10-30-goals-system). The six active goals in prod on
 * 2026-10-30, as SHAPES only (horizon, dates, whether a target is set, progress);
 * no titles. Scored on the old card logic and on goalPaceView. Each wave adds its
 * own measure here so the PR body can quote one number before and after.
 */
import { describe, expect, it } from "vitest";

import { computePace } from "@/lib/brain/goal-pace";
import { goalPaceView } from "@/components/goals/goal-board";

const NOW = Date.parse("2026-10-30T13:00:00.000Z");
type Shape = { horizon: string | null; createdAt: string; targetValue: number; currentValue: number };
// targetValue 3 only stands in for "a target is set"; the real values were not read.
const LIVE_2026_10_30: Shape[] = [
  { horizon: "YEAR", createdAt: "2026-04-28T18:04:58.979Z", targetValue: 0, currentValue: 6 },
  { horizon: null, createdAt: "2026-09-08T02:03:40.971Z", targetValue: 3, currentValue: 2 },
  { horizon: null, createdAt: "2026-09-08T02:03:40.972Z", targetValue: 3, currentValue: 1 },
  { horizon: "LIFE", createdAt: "2026-10-28T15:59:04.662Z", targetValue: 0, currentValue: 0 },
  { horizon: "WEEK", createdAt: "2026-10-28T16:01:30.250Z", targetValue: 0, currentValue: 0 },
  { horizon: "MONTH", createdAt: "2026-10-28T16:03:33.712Z", targetValue: 0, currentValue: 0 },
];
const goals = LIVE_2026_10_30.map((s) => ({ ...s, unit: "", status: "active", deadline: null }));

// Old card (before W1): a chip only when computePace on the stored deadline scored.
const oldSignal = (g: (typeof goals)[number]) =>
  computePace({ currentValue: g.currentValue, targetValue: g.targetValue, deadline: g.deadline, createdAt: g.createdAt }).kind !== "unscored";

describe("goal signal eval · 6 live goal shapes", () => {
  it("W1: goals with a date signal (pace or time left) go 0 -> 3, and every goal says something", () => {
    const views = goals.map((g) => goalPaceView(g, NOW));
    const before = goals.filter(oldSignal).length;
    const after = views.filter((v) => v?.kind === "chip" || v?.kind === "time").length;
    const explained = views.filter((v) => v !== null).length;
    expect({ before, after, explained }).toEqual({ before: 0, after: 3, explained: 6 });
  });
});
