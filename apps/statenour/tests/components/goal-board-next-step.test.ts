/**
 * Goal card "No next step" (job 2026-10-30-goals-system W3): shows only on an active goal
 * with no open linked task; carries the journal's suggestion when there is one; an unknown
 * count (an older payload without it) shows nothing rather than a false "no next step".
 */
import { describe, expect, it } from "vitest";

import { goalNextStepView } from "@/components/goals/goal-board";

describe("goalNextStepView", () => {
  it("an active goal with no open task asks for a next step, with the journal's suggestion", () => {
    expect(
      goalNextStepView({ status: "active", linkedNextStepCount: 0, suggestedStep: { title: "Call the supplier", dumpId: "d1" } }),
    ).toEqual({ show: true, suggestion: { title: "Call the supplier", dumpId: "d1" } });
  });

  it("no suggestion is fine: the chip still shows, with nothing invented", () => {
    expect(goalNextStepView({ status: "active", linkedNextStepCount: 0, suggestedStep: null })).toEqual({ show: true, suggestion: null });
  });

  it("a goal with an open task, a finished goal, or an unknown count shows nothing", () => {
    expect(goalNextStepView({ status: "active", linkedNextStepCount: 1, suggestedStep: null }).show).toBe(false);
    expect(goalNextStepView({ status: "achieved", linkedNextStepCount: 0, suggestedStep: null }).show).toBe(false);
    expect(goalNextStepView({ status: "active", linkedNextStepCount: undefined, suggestedStep: null }).show).toBe(false);
  });
});
