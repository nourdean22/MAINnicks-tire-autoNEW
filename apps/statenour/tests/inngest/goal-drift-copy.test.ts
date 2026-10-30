import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inngest/client", () => ({ getInngest: () => ({ createFunction: () => ({}) }) }));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent: vi.fn(), ackCoachEvent: vi.fn(), buildCoachEventKey: vi.fn() }));

import { bodyFor, daysToDue, driftProgress, movementCounts, titleFor, type DriftFlag } from "@/lib/inngest/functions/goal-drift-detector";

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

  it("a due time that passed earlier today is past, never 0 days left (Codex P2)", () => {
    const now = Date.parse("2026-10-30T16:00:00.000Z");
    const d = daysToDue({ at: "2026-10-30T14:00:00.000Z", source: "set", label: "deadline" }, 5, now);
    expect(d).not.toBeNull();
    expect(d as number).toBeLessThan(0);
  });

  it("progress is read from currentValue and targetValue, not a stale stored percent (Codex P2)", () => {
    expect(driftProgress({ currentValue: 6, targetValue: 5, progress: 0 })).toBe(100);
    expect(driftProgress({ currentValue: 1, targetValue: 4, progress: 90 })).toBe(25);
    expect(driftProgress({ currentValue: 3, targetValue: 0, progress: 40 })).toBe(40);
  });

  it("creating a goal or setting its horizon is not movement (Codex P2)", () => {
    const now = Date.parse("2026-10-30T16:00:00.000Z");
    const recent = new Date(now - 86_400_000);
    const prior = new Date(now - 10 * 86_400_000);
    const out = movementCounts(
      [
        { kind: "created", createdAt: recent },
        { kind: "horizon_set", createdAt: recent },
        { kind: "progress_logged", createdAt: prior },
      ],
      new Date(now - 7 * 86_400_000),
    );
    expect(out).toMatchObject({ recentEvents: 0, priorEvents: 1 });
  });
});
