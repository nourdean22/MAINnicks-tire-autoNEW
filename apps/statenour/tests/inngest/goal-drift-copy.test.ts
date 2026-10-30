import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/client", () => ({ getInngest: () => ({ createFunction: () => ({}) }) }));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent: vi.fn(), ackCoachEvent: vi.fn(), buildCoachEventKey: vi.fn() }));

import { bodyFor, daysToDue, titleFor, type DriftFlag } from "@/lib/inngest/functions/goal-drift-detector";

const base: DriftFlag = {
  goalId: "g1",
  goalTitle: "Goal",
  horizon: "WEEK",
  verdict: { signal: "deadline-risk", priority: "P1" },
  daysSinceActivity: 3,
  progress: 0,
  daysToDeadline: 2,
  dueLabel: "end of week (from horizon)",
};

describe("goal drift copy", () => {
  it("names a horizon-derived date as derived, never as his deadline", () => {
    expect(titleFor(base)).toBe("Time risk · Goal · 2d to end of week (from horizon) at 0%");
    expect(bodyFor(base)).toContain("2 days to the end of week (from horizon)");
    expect(bodyFor(base)).not.toMatch(/deadline/);
  });

  it("keeps the deadline wording when Nour set the date", () => {
    const set = { ...base, dueLabel: "deadline" };
    expect(titleFor(set)).toBe("Deadline risk · Goal · 2d to deadline at 0%");
    expect(bodyFor(set)).toContain("move the date");
  });

  it("a horizon date on a goal with no target never feeds a risk alert (nothing to be 'at 0%' of)", () => {
    const now = Date.parse("2026-10-30T12:30:00.000Z");
    const due = { at: "2026-11-02T04:59:59.999Z", source: "horizon" as const, label: "end of week (from horizon)" };
    expect(daysToDue(due, 0, now)).toBeNull();
    expect(daysToDue(due, 5, now)).toBe(2);
    expect(daysToDue({ at: "2026-11-02T04:59:59.999Z", source: "set", label: "deadline" }, 0, now)).toBe(2);
  });
});
