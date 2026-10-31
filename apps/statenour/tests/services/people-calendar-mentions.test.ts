/**
 * People W4 S1 (2026-10-30): an upcoming calendar event that names a person.
 * Pure, no calendar call. Matching is by the person's exact name in the event
 * title (the W1 nameMatcher), never by attendee email: the schema says
 * PersonProfile.email is "NOT a match key".
 */
import { describe, expect, it } from "vitest";

import { nextEventByPerson, seeingLabel } from "@/lib/services/people/calendar-mentions";

const people = [
  { id: "p1", name: "Sam Rivers" },
  { id: "p2", name: "Ana" },
];
const now = new Date("2026-10-30T16:00:00Z"); // Friday noon in New York

describe("nextEventByPerson", () => {
  it("finds the earliest upcoming event whose title names the person", () => {
    const out = nextEventByPerson(
      [
        { summary: "Lunch with Sam Rivers", start: "2026-11-01T17:00:00Z" },
        { summary: "Call Sam Rivers", start: "2026-10-31T15:00:00Z" },
        { summary: "Ana's birthday dinner", start: "2026-11-02T23:00:00Z" },
      ],
      people,
      now,
    );
    expect(out.get("p1")).toEqual(new Date("2026-10-31T15:00:00Z"));
    expect(out.get("p2")).toEqual(new Date("2026-11-02T23:00:00Z"));
  });

  it("ignores past events, untitled events, events without a start, and near-miss names", () => {
    const out = nextEventByPerson(
      [
        { summary: "Coffee with Sam Rivers", start: "2026-10-29T15:00:00Z" },
        { summary: undefined, start: "2026-10-31T15:00:00Z" },
        { summary: "Ana sync", start: undefined },
        { summary: "Banana bread with Sam", start: "2026-10-31T15:00:00Z" },
      ],
      people,
      now,
    );
    expect(out.size).toBe(0);
  });

  it("an all-day event (a date with no time) still counts", () => {
    const out = nextEventByPerson([{ summary: "Ana visiting", start: "2026-10-31" }], people, now);
    expect(out.has("p2")).toBe(true);
  });

  it("never reads attendee emails", () => {
    const out = nextEventByPerson(
      [{ summary: "Team sync", start: "2026-10-31T15:00:00Z", attendees: ["sam.rivers@example.com"] }],
      people,
      now,
    );
    expect(out.size).toBe(0);
  });
});

describe("seeingLabel", () => {
  it("says today, tomorrow, or the New York weekday", () => {
    expect(seeingLabel(new Date("2026-10-30T22:00:00Z"), now)).toBe("today");
    // 01:00Z on Oct 31 is still Oct 30 in New York.
    expect(seeingLabel(new Date("2026-10-31T01:00:00Z"), now)).toBe("today");
    expect(seeingLabel(new Date("2026-10-31T15:00:00Z"), now)).toBe("tomorrow");
    expect(seeingLabel(new Date("2026-11-02T15:00:00Z"), now)).toBe("Monday");
  });
});
