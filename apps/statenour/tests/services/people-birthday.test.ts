/**
 * Birthdays count days on Nour's clock, America/New_York (people W0, 2026-10-30).
 *
 * The picks, the watchlist and the birthday cron each took today's month-day
 * from `toISOString()`, which is UTC. From 20:00 ET (19:00 in winter) UTC is
 * already tomorrow, so an evening look said "birthday in 0d" a day early and
 * "today" vanished the evening of the day itself.
 */
import { describe, expect, it } from "vitest";

import { daysUntilBirthday, monthDayET } from "@/lib/services/people/birthday";

describe("monthDayET", () => {
  it("reads the Eastern date, not the UTC one", () => {
    // 2026-10-31T01:30Z is 21:30 on Oct 30 in New York.
    expect(monthDayET(new Date("2026-10-31T01:30:00Z"))).toBe("10-30");
    expect(monthDayET(new Date("2026-10-30T16:00:00Z"))).toBe("10-30");
  });
});

describe("daysUntilBirthday", () => {
  it("an evening look in New York still counts from today", () => {
    const evening = new Date("2026-10-31T01:30:00Z"); // Oct 30, 21:30 ET
    expect(daysUntilBirthday("1985-10-31", evening)).toBe(1);
    expect(daysUntilBirthday("1985-10-30", evening)).toBe(0);
  });

  it("wraps the year on New Year's Eve evening", () => {
    const nye = new Date("2027-01-01T04:00:00Z"); // Dec 31 2026, 23:00 ET
    expect(daysUntilBirthday("1990-01-01", nye)).toBe(1);
    expect(daysUntilBirthday("1990-12-31", nye)).toBe(0);
  });

  it("a passed birthday points at next year", () => {
    expect(daysUntilBirthday("1990-10-29", new Date("2026-10-30T16:00:00Z"))).toBe(364);
  });

  it("Feb 29 lands on Mar 1 in a non-leap year", () => {
    expect(daysUntilBirthday("1992-02-29", new Date("2027-02-28T17:00:00Z"))).toBe(1);
  });

  it("missing or malformed dates are null, never a number", () => {
    for (const b of [null, undefined, "", "March 3", "1985-13-40", "1990-02-30", "1990-04-31"]) {
      expect(daysUntilBirthday(b, new Date("2026-10-30T16:00:00Z"))).toBeNull();
    }
  });
});
