import { describe, expect, it } from "vitest";
import { briefCalendarLine, nickCalendarBlock } from "@/lib/calendar/day-lines";
import type { CalendarRead, DayEvent } from "@/lib/calendar/day-events";

const NOW = new Date("2026-10-30T16:00:00Z"); // 12:00 PM ET
const timed = (id: string, start: string, end: string): DayEvent => ({
  id, title: `Title ${id}`, start, end, allDay: false, accountKey: "primary",
});
const ok = (events: DayEvent[]): CalendarRead => ({
  state: "ok", events, sources: { accounts: 1, calendars: 2 }, failedAccounts: [],
});

describe("briefCalendarLine", () => {
  it("names the count, the first event and the longest free block", () => {
    const line = briefCalendarLine(
      ok([timed("a", "2026-10-30T14:00:00Z", "2026-10-30T15:00:00Z"), timed("b", "2026-10-30T18:00:00Z", "2026-10-30T19:00:00Z")]),
      null,
      NOW,
    );
    expect(line).toBe("Calendar: 2 events · first 10:00 AM · longest free 3:00 PM-9:00 PM");
  });

  it("never lets a dead read look like a calm day", () => {
    expect(briefCalendarLine({ state: "read_failed", reason: "x" }, null, NOW)).toBe("Calendar: unknown (read failed)");
    expect(briefCalendarLine({ state: "not_connected" }, null, NOW)).toBe("Calendar: not connected");
    expect(briefCalendarLine({ state: "expired", accounts: ["personal"] }, null, NOW)).toBe(
      "Calendar: Google grant expired (personal), re-grant to read it",
    );
  });

  it("names the shop account linked in his slot instead of reading its calendar", () => {
    expect(briefCalendarLine({ state: "not_connected", reason: "shop_account" }, null, NOW)).toBe(
      "Calendar: not connected (the linked Google account is the shop's; connect nourdean22)",
    );
  });

  it("flags a connected calendar that has held nothing for three weeks", () => {
    expect(briefCalendarLine(ok([]), ok([]), NOW)).toBe(
      "Calendar: connected, but 0 events in the last 7 and next 14 days. Is the calendar you use connected?",
    );
  });

  it("says nothing is booked when today is empty but the calendar is in use", () => {
    expect(briefCalendarLine(ok([]), ok([timed("x", "2026-10-25T14:00:00Z", "2026-10-25T15:00:00Z")]), NOW)).toBe(
      "Calendar: nothing booked today",
    );
  });

  it("names an account it could not read", () => {
    const r: CalendarRead = { state: "ok", events: [], sources: { accounts: 2, calendars: 2 }, failedAccounts: ["personal"] };
    expect(briefCalendarLine(r, null, NOW)).toBe("Calendar: nothing booked today (personal unreadable)");
  });
});

describe("nickCalendarBlock", () => {
  it("lists today's events with times, the current block and the free time left", () => {
    const block = nickCalendarBlock(
      ok([timed("now", "2026-10-30T15:30:00Z", "2026-10-30T16:30:00Z"), timed("later", "2026-10-30T19:00:00Z", "2026-10-30T20:00:00Z")]),
      NOW,
    );
    expect(block).toContain("### CALENDAR TODAY (live, 2 events)");
    expect(block).toContain("- 11:30 AM-12:30 PM Title now");
    expect(block).toContain("Now: Title now (until 12:30 PM)");
    expect(block).toContain("Next: Title later at 3:00 PM");
    expect(block).toContain("Longest free block left: 4:00 PM-9:00 PM (5h)");
  });

  it("tells Nick the schedule is unknown, not empty, when the read failed", () => {
    expect(nickCalendarBlock({ state: "read_failed", reason: "x" }, NOW)).toMatch(/unknown, not empty/);
  });

  it("tells Nick his own calendar is not connected when only the shop account is linked", () => {
    const block = nickCalendarBlock({ state: "not_connected", reason: "shop_account" }, NOW);
    expect(block).toMatch(/shop's Google account/);
    expect(block).toMatch(/unknown/);
  });

  it("tells Nick not to invent meetings on an empty day", () => {
    expect(nickCalendarBlock(ok([]), NOW)).toMatch(/no events.*do not invent/i);
  });
});
