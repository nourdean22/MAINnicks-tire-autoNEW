/**
 * Goal health from the latest check-in (job 2026-11-02-nour-os-interconnect W2, Linear L2):
 * staleness is a visible state, never a silent green. One cadence table (horizon -> days) drives
 * the card's chip AND Home's "check-in due" row, so the two can never disagree.
 */
import { describe, expect, it } from "vitest";
import {
  CHECK_IN_CADENCE_DAYS,
  checkInCadenceDays,
  goalHealthFrom,
  checkInOverdueDays,
  pickCheckInDue,
} from "@/lib/brain/goal-pace";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-02T15:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY);

describe("the cadence table", () => {
  it("is the horizon in days, named once", () => {
    expect(CHECK_IN_CADENCE_DAYS).toEqual({ DAY: 1, WEEK: 7, MONTH: 30, QUARTER: 90, YEAR: 180 });
  });
  it("a LIFE or missing horizon falls back to the YEAR cadence", () => {
    expect(checkInCadenceDays("LIFE")).toBe(180);
    expect(checkInCadenceDays(null)).toBe(180);
    expect(checkInCadenceDays("WEEK")).toBe(7);
  });
});

describe("goalHealthFrom", () => {
  it("no check-in at all is no_check_in with no date", () => {
    expect(goalHealthFrom(null, "WEEK", NOW)).toEqual({ state: "no_check_in", at: null, note: null });
  });
  it("a check-in inside the cadence carries its health, date and note", () => {
    const h = goalHealthFrom({ payload: { health: "at_risk", note: "supplier slipped" }, createdAt: ago(3) }, "WEEK", NOW);
    expect(h).toEqual({ state: "at_risk", at: ago(3).toISOString(), note: "supplier slipped" });
  });
  it("a check-in older than the cadence goes gray, but keeps its date so the since-list starts there", () => {
    const h = goalHealthFrom({ payload: { health: "on_track", note: "fine" }, createdAt: ago(8) }, "WEEK", NOW);
    expect(h.state).toBe("no_check_in");
    expect(h.at).toBe(ago(8).toISOString());
  });
  it("the same 8-day-old check-in is still current on a MONTH goal (the table, not a constant)", () => {
    const h = goalHealthFrom({ payload: { health: "on_track", note: "" }, createdAt: ago(8) }, "MONTH", NOW);
    expect(h.state).toBe("on_track");
  });
  it("a payload health outside the three states reads unknown, never on_track", () => {
    const h = goalHealthFrom({ payload: { health: "great" }, createdAt: ago(1) }, "WEEK", NOW);
    expect(h.state).toBe("unknown");
  });
});

describe("the cadence boundary (second reader, 2026-11-02)", () => {
  const exactly = new Date(NOW - 7 * DAY);
  const justPast = new Date(NOW - 7 * DAY - 1);
  it("a WEEK check-in exactly 7 days old keeps its health and is not yet due", () => {
    expect(goalHealthFrom({ payload: { health: "on_track" }, createdAt: exactly }, "WEEK", NOW).state).toBe("on_track");
    expect(checkInOverdueDays({ horizon: "WEEK", createdAt: ago(40), lastCheckInAt: exactly }, NOW)).toBe(-1);
    expect(pickCheckInDue([{ id: "a", title: "A", horizon: "WEEK", createdAt: ago(40), lastCheckInAt: exactly }], NOW)).toBeNull();
  });
  it("one millisecond later it is gray and due, 0 days over", () => {
    expect(goalHealthFrom({ payload: { health: "on_track" }, createdAt: justPast }, "WEEK", NOW).state).toBe("no_check_in");
    expect(pickCheckInDue([{ id: "a", title: "A", horizon: "WEEK", createdAt: ago(40), lastCheckInAt: justPast }], NOW)).toEqual({
      goalId: "a",
      title: "A",
      daysOverdue: 0,
    });
  });
});

describe("checkInOverdueDays / pickCheckInDue", () => {
  it("counts from the last check-in, else from creation", () => {
    expect(checkInOverdueDays({ horizon: "WEEK", createdAt: ago(40), lastCheckInAt: ago(10) }, NOW)).toBe(3);
    expect(checkInOverdueDays({ horizon: "WEEK", createdAt: ago(10), lastCheckInAt: null }, NOW)).toBe(3);
    expect(checkInOverdueDays({ horizon: "WEEK", createdAt: ago(40), lastCheckInAt: ago(2) }, NOW)).toBeLessThan(0);
  });
  it("Home gets the single most overdue goal, or null when none is due", () => {
    const goals = [
      { id: "a", title: "Week goal", horizon: "WEEK", createdAt: ago(40), lastCheckInAt: ago(9) },
      { id: "b", title: "Month goal", horizon: "MONTH", createdAt: ago(50), lastCheckInAt: null },
      { id: "c", title: "Fresh", horizon: "WEEK", createdAt: ago(40), lastCheckInAt: ago(1) },
    ];
    expect(pickCheckInDue(goals, NOW)).toEqual({ goalId: "b", title: "Month goal", daysOverdue: 20 });
    expect(pickCheckInDue([goals[2]], NOW)).toBeNull();
  });
});
