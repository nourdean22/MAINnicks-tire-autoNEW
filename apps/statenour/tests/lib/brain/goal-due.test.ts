import { describe, expect, it } from "vitest";
import { computePace, goalDue } from "@/lib/brain/goal-pace";

// A date Nour set always wins; a horizon only gives a DERIVED date (end of the ET
// period the goal was created in), labelled as derived so it never reads as his commitment.
describe("goalDue", () => {
  it("keeps a deadline Nour set, labelled as his", () => {
    const d = goalDue({ deadline: "2026-12-01T12:00:00.000Z", horizon: "WEEK", createdAt: "2026-10-28T16:00:00.000Z" });
    expect(d).toEqual({ at: "2026-12-01T12:00:00.000Z", source: "set", label: "deadline" });
  });

  it("WEEK created Sunday 23:59 ET ends that same Sunday (Mon-Sun week)", () => {
    // 2026-10-25 23:59 EDT = 03:59Z on the 26th
    const d = goalDue({ deadline: null, horizon: "WEEK", createdAt: "2026-10-26T03:59:00.000Z" });
    expect(d.at).toBe("2026-10-26T03:59:59.999Z");
    expect(d.source).toBe("horizon");
    expect(d.label).toBe("end of week (from horizon)");
  });

  it("WEEK created Monday 00:00 ET ends the next Sunday, across the DST change", () => {
    // 2026-10-26 00:00 EDT; the week ends Sun 2026-11-01 23:59:59.999 EST (UTC-5)
    const d = goalDue({ deadline: null, horizon: "WEEK", createdAt: "2026-10-26T04:00:00.000Z" });
    expect(d.at).toBe("2026-11-02T04:59:59.999Z");
  });

  it("DAY, MONTH, QUARTER and YEAR end at the ET period end", () => {
    const createdAt = "2026-10-28T16:00:00.000Z"; // Wed 12:00 EDT
    expect(goalDue({ deadline: null, horizon: "DAY", createdAt }).at).toBe("2026-10-29T03:59:59.999Z");
    expect(goalDue({ deadline: null, horizon: "MONTH", createdAt }).at).toBe("2026-11-01T03:59:59.999Z");
    expect(goalDue({ deadline: null, horizon: "QUARTER", createdAt }).at).toBe("2027-01-01T04:59:59.999Z");
    expect(goalDue({ deadline: null, horizon: "YEAR", createdAt }).at).toBe("2027-01-01T04:59:59.999Z");
    expect(goalDue({ deadline: null, horizon: "MONTH", createdAt }).label).toBe("month end (from horizon)");
  });

  it("QUARTER ends at each calendar quarter, including a goal created at the quarter's first ms", () => {
    const q = (createdAt: string) => goalDue({ deadline: null, horizon: "QUARTER", createdAt }).at;
    expect(q("2026-03-31T16:00:00.000Z")).toBe("2026-04-01T03:59:59.999Z");
    expect(q("2026-06-15T16:00:00.000Z")).toBe("2026-07-01T03:59:59.999Z");
    expect(q("2026-09-30T16:00:00.000Z")).toBe("2026-10-01T03:59:59.999Z");
    expect(q("2026-04-01T04:00:00.000Z")).toBe("2026-07-01T03:59:59.999Z");
    expect(q("2026-04-01T03:59:59.999Z")).toBe("2026-04-01T03:59:59.999Z");
  });

  it("spring-forward and fall-back days end at ET midnight", () => {
    expect(goalDue({ deadline: null, horizon: "DAY", createdAt: "2027-03-14T16:00:00.000Z" }).at).toBe("2027-03-15T03:59:59.999Z");
    expect(goalDue({ deadline: null, horizon: "MONTH", createdAt: "2027-03-01T17:00:00.000Z" }).at).toBe("2027-04-01T03:59:59.999Z");
    expect(goalDue({ deadline: null, horizon: "DAY", createdAt: "2026-11-01T16:00:00.000Z" }).at).toBe("2026-11-02T04:59:59.999Z");
  });

  it("a lowercase horizon works; a Date deadline works", () => {
    expect(goalDue({ deadline: null, horizon: "week", createdAt: "2026-10-26T04:00:00.000Z" }).at).toBe("2026-11-02T04:59:59.999Z");
    expect(goalDue({ deadline: new Date("2026-12-01T12:00:00.000Z"), horizon: null, createdAt: null }).source).toBe("set");
  });

  it("a horizon set after creation counts from when it was set, not from createdAt (Codex P2)", () => {
    // created in September, re-paced to WEEK on Mon 2026-10-26: the week of Oct 26
    const d = goalDue({ deadline: null, horizon: "WEEK", createdAt: "2026-09-08T02:00:00.000Z", horizonSetAt: "2026-10-26T15:00:00.000Z" });
    expect(d.at).toBe("2026-11-02T04:59:59.999Z");
  });

  it("LIFE and no horizon stay unscored and say why", () => {
    expect(goalDue({ deadline: null, horizon: "LIFE", createdAt: "2026-10-28T16:00:00.000Z" })).toEqual({
      at: null,
      source: null,
      label: "unscored: a lifetime goal has no date",
    });
    expect(goalDue({ deadline: null, horizon: null, createdAt: "2026-10-28T16:00:00.000Z" })).toEqual({
      at: null,
      source: null,
      label: "unscored: no deadline or horizon set",
    });
  });

  it("an unreadable date never throws inside a render; it reads as unscored", () => {
    expect(goalDue({ deadline: "not a date", horizon: null, createdAt: null }).at).toBeNull();
    expect(goalDue({ deadline: null, horizon: "WEEK", createdAt: "garbage" })).toEqual({
      at: null,
      source: null,
      label: "unscored: horizon or date unreadable",
    });
  });

  it("a horizon goal now gets a pace verdict instead of unscored", () => {
    const g = { currentValue: 0, targetValue: 5, deadline: null, horizon: "YEAR", createdAt: "2026-10-28T16:00:00.000Z" };
    expect(computePace({ ...g, deadline: g.deadline }).kind).toBe("unscored");
    expect(computePace({ ...g, deadline: goalDue(g).at }).kind).not.toBe("unscored");
  });
});
