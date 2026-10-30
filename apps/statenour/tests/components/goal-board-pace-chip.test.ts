/**
 * GoalBoard pace chip (job 2026-10-30-goals-system W1). A horizon gives a goal a
 * DERIVED date when Nour set none; the chip says "(from horizon)" so it never
 * reads as his deadline. No date at all says why it is unscored.
 */
import { describe, expect, it } from "vitest";

import { goalPaceView } from "@/components/goals/goal-board";

const base = { currentValue: 0, targetValue: 5, unit: "", status: "active", createdAt: "2026-10-28T16:00:00.000Z" };

describe("goalPaceView", () => {
  it("a WEEK goal with no deadline gets a pace chip labelled as derived", () => {
    const v = goalPaceView({ ...base, deadline: null, horizon: "WEEK" });
    expect(v?.kind).toBe("chip");
    expect(v && v.kind === "chip" && v.label).toMatch(/· end of week \(from horizon\)$/);
  });

  it("a set deadline keeps the plain pace label", () => {
    const v = goalPaceView({ ...base, deadline: "2027-06-01T12:00:00.000Z", horizon: "WEEK" });
    expect(v?.kind).toBe("chip");
    expect(v && v.kind === "chip" && v.label).not.toMatch(/from horizon/);
  });

  it("no deadline and no horizon says why it is unscored", () => {
    expect(goalPaceView({ ...base, deadline: null, horizon: null })).toEqual({
      kind: "note",
      text: "unscored: no deadline or horizon set",
    });
  });

  it("a dated goal with no target shows time left, labelled, instead of nothing", () => {
    const now = Date.parse("2026-10-30T13:00:00.000Z");
    const v = goalPaceView({ ...base, targetValue: 0, deadline: null, horizon: "WEEK" }, now);
    expect(v).toEqual({ kind: "time", label: "2d left · end of week (from horizon) · no target set" });
  });

  it("a period that has ended says so", () => {
    const now = Date.parse("2026-11-04T13:00:00.000Z");
    const v = goalPaceView({ ...base, targetValue: 0, deadline: null, horizon: "WEEK" }, now);
    expect(v).toEqual({ kind: "time", label: "ended 3d ago · end of week (from horizon) · no target set" });
  });

  it("a derived date that has passed says ended, never 'past deadline'", () => {
    const now = Date.parse("2026-11-04T13:00:00.000Z");
    const v = goalPaceView({ ...base, targetValue: 5, currentValue: 1, deadline: null, horizon: "WEEK" }, now);
    expect(v?.kind).toBe("chip");
    const label = v && v.kind === "chip" ? v.label : "";
    expect(label).toMatch(/^ended \d+d ago · end of week \(from horizon\)$/);
    expect(label).not.toMatch(/deadline/);
  });

  it("an unreadable horizon says so, not 'no horizon set'", () => {
    expect(goalPaceView({ ...base, deadline: null, horizon: "Q1" })).toEqual({
      kind: "note",
      text: "unscored: horizon or date unreadable",
    });
  });

  it("a horizon period under two days shows time left, not a pace verdict that floors to one day (Codex P2)", () => {
    const now = Date.parse("2026-10-30T13:05:00.000Z");
    const v = goalPaceView({ ...base, targetValue: 5, currentValue: 1, deadline: null, horizon: "DAY", createdAt: "2026-10-30T13:00:00.000Z" }, now);
    expect(v).toEqual({ kind: "time", label: "0d left · end of day (from horizon)" });
  });

  it("a date that passed earlier today reads 'ended today', never '0d left' (Codex P2)", () => {
    const now = Date.parse("2026-10-30T16:00:00.000Z");
    const v = goalPaceView({ ...base, targetValue: 0, deadline: "2026-10-30T14:00:00.000Z", horizon: null }, now);
    expect(v).toEqual({ kind: "time", label: "ended today · deadline · no target set" });
  });

  it("a goal created 40 days ago and re-paced to WEEK today is due this week, not overdue (manager case)", () => {
    const now = Date.parse("2026-10-30T15:30:00.000Z"); // Fri 11:30 ET
    const g = { ...base, targetValue: 0, deadline: null, horizon: "WEEK", createdAt: "2026-09-20T15:00:00.000Z" };
    expect(goalPaceView(g, now)).toEqual({ kind: "time", label: "ended 40d ago · end of week (from horizon) · no target set" });
    expect(goalPaceView({ ...g, horizonSetAt: "2026-10-30T15:00:00.000Z" }, now)).toEqual({
      kind: "time",
      label: "2d left · end of week (from horizon) · no target set",
    });
  });

  it("a finished goal shows no unscored note", () => {
    expect(goalPaceView({ ...base, status: "achieved", deadline: null, horizon: null })).toBeNull();
  });
});
