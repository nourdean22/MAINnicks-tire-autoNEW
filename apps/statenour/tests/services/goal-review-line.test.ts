/**
 * Monday brief Goals line (job 2026-10-30-goals-system W2). GTD weekly review,
 * "Get Current": every active goal should carry at least one current action.
 * The line reads real rows only: no goals is UNMEASURED, a failed read is ERROR,
 * never a 0.
 */
import { describe, expect, it } from "vitest";

import { goalReviewLines, type GoalReviewRow } from "@/lib/services/goal-review-line";

const NOW = Date.parse("2026-11-02T11:00:00.000Z"); // Mon 06:00 ET
const row = (over: Partial<GoalReviewRow>): GoalReviewRow => ({
  id: "g",
  title: "Goal",
  horizon: null,
  deadline: null,
  createdAt: "2026-10-28T16:00:00.000Z",
  targetValue: 0,
  currentValue: 0,
  openTasks: 0,
  ...over,
});

describe("goalReviewLines", () => {
  it("counts active goals and the ones with a next step", () => {
    const out = goalReviewLines([row({ id: "a", openTasks: 2 }), row({ id: "b" }), row({ id: "c" })], NOW);
    expect(out.lines[0]).toBe("<b>Goals</b> · 3 active · 1 with a next step");
    expect(out.payload).toMatchObject({ state: "measured", active: 3, withNextStep: 1, noNextStepIds: ["b", "c"] });
  });

  it("names the goal furthest behind on a date, labelled as derived when it is", () => {
    const out = goalReviewLines(
      [
        row({ id: "w", title: "Week goal", horizon: "WEEK", createdAt: "2026-10-28T16:00:00.000Z" }),
        row({ id: "y", title: "Year goal", horizon: "YEAR" }),
      ],
      NOW,
    );
    expect(out.lines[1]).toBe("Past its date: Week goal · ended 1d ago · end of week (from horizon) · no target set");
    expect(out.payload).toMatchObject({ pastDueIds: ["w"] });
  });

  it("a goal re-paced to WEEK this week is not past its date, though it was created long ago", () => {
    const g = row({ id: "r", horizon: "WEEK", createdAt: "2026-09-08T02:00:00.000Z" });
    expect(goalReviewLines([g], NOW).payload).toMatchObject({ pastDueIds: ["r"] });
    expect(goalReviewLines([{ ...g, horizonSetAt: "2026-11-02T10:30:00.000Z" }], NOW).payload).toMatchObject({ pastDueIds: [] });
  });

  it("says what the goal card says (one shared verdict, job W2 review)", () => {
    // DAY goal 1 of 5 at 06:00 ET: the card shows time left, so the brief must not call it behind
    const day = row({ id: "d", title: "Day goal", horizon: "DAY", createdAt: "2026-11-02T05:30:00.000Z", targetValue: 5, currentValue: 1 });
    expect(goalReviewLines([day], NOW).lines).toEqual(["<b>Goals</b> · 1 active · 0 with a next step"]);
    // target met before a passed deadline: "at target" on the card, never "past its date" here
    const met = row({ id: "m", deadline: "2026-10-26T12:00:00.000Z", targetValue: 10, currentValue: 10 });
    expect(goalReviewLines([met], NOW).payload).toMatchObject({ pastDueIds: [] });
  });

  it("a deadline that passed earlier today is past its date", () => {
    const g = row({ id: "t", title: "Today", deadline: "2026-11-02T10:00:00.000Z", targetValue: 10, currentValue: 3 });
    const out = goalReviewLines([g], NOW);
    expect(out.payload).toMatchObject({ pastDueIds: ["t"] });
    expect(out.lines[1]).toMatch(/^Past its date: Today · /);
  });

  it("names the goal furthest behind on pace when none is past its date", () => {
    const b = row({ id: "b", title: "Behind goal", deadline: "2026-11-30T12:00:00.000Z", createdAt: "2026-10-01T12:00:00.000Z", targetValue: 60, currentValue: 5 });
    expect(goalReviewLines([b], NOW).lines[1]).toMatch(/^Behind: Behind goal · behind/);
  });

  it("no active goals is UNMEASURED, not zero", () => {
    const out = goalReviewLines([], NOW);
    expect(out.lines).toEqual(["<b>Goals</b> · not measured yet: no active goals"]);
    expect(out.payload).toEqual({ state: "unmeasured" });
  });

  it("a failed read is ERROR, never zero", () => {
    const out = goalReviewLines("error", NOW);
    expect(out.lines).toEqual(["<b>Goals</b> · unknown (the goals read failed)"]);
    expect(out.payload).toEqual({ state: "error" });
  });

  it("escapes a goal title for the HTML brief", () => {
    const out = goalReviewLines([row({ id: "x", title: "a <b> & c", horizon: "DAY", createdAt: "2026-10-30T16:00:00.000Z" })], NOW);
    expect(out.lines[1]).toContain("a &lt;b&gt; &amp; c");
  });

  it("the payload carries ids and counts, never a title", () => {
    const out = goalReviewLines([row({ id: "w", title: "Private title", horizon: "WEEK" })], NOW);
    expect(JSON.stringify(out.payload)).not.toContain("Private title");
  });
});
