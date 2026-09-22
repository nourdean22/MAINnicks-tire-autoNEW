/**
 * A "we'll call you back" promise is due at the CLOSE of the business day the
 * shop can next act on — never at the instant it becomes able to act.
 *
 * THE DEFECT THIS PINS shipped in the first version of the voice-promise wiring
 * and was caught in review on PR #2479. `dueAt` was `nextOpenAt()`, which
 * returns `now` when the shop is ALREADY OPEN. So a callback promised at 10am
 * on a Tuesday was due at 10am that Tuesday — overdue one second later. The
 * overdue sweep would escalate it into the Decision Inbox and, 48h on, stamp it
 * `missed`: a broken-promise record against a shop that had all day to keep it.
 *
 * It was not a closed-hours-only path either. `escalate` is exposed to the
 * OUTBOUND follow-up assistant, whose script says "we'll have someone call you
 * back today", and those calls are placed during business hours by design.
 *
 * WHY NOT JUST REFUSE WHEN OPEN: most calls arrive while the shop is open, so
 * refusing would have left voice promises existing only for after-hours calls —
 * a silent hole across the hours the business actually runs.
 *
 * THE DEADLINE IS DERIVED, NOT INVENTED. The outbound script states "today", so
 * close-of-business is the shop's own bound; the inbound script states no time,
 * but the shop can only act while open, so closing time is the last moment it
 * can honour the promise that day. That is a property of the hours.
 *
 * EVERY ASSERTION GOES THROUGH `nextCloseAt`, the only exported entry point.
 * `nextOpenAt` is now an internal helper: it has no production caller since the
 * voiceAgent sites moved here, so exporting it would leave its sole importer
 * its own test — the knip orphan shape that hid `ingestFinishedMp4` for weeks.
 * Its coverage was folded into this file rather than baselined past the gate:
 * the day-walking and DST cases below exercise exactly the same code, through
 * the function that actually ships.
 */
import { describe, expect, it } from "vitest";

import { nextCloseAt } from "./shopState";

const TZ = "America/New_York";
/** Mon-Fri 08:00-18:00, Sat 09:00-16:00, Sunday closed (no key). */
const HOURS: Record<string, string> = {
  monday: "08:00-18:00",
  tuesday: "08:00-18:00",
  wednesday: "08:00-18:00",
  thursday: "08:00-18:00",
  friday: "08:00-18:00",
  saturday: "09:00-16:00",
};

/**
 * The shop-local wall clock of an instant, for readable assertions.
 *
 * The comma is normalised away on purpose: Intl emits "Tue, 10:00" on some
 * engines and "Tue 10:00" on others, and a test that fails on a separator
 * across Node versions is noise that teaches people to edit expectations.
 */
const local = (d: Date | null | undefined) =>
  d == null
    ? null
    : new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .format(d)
        .replace(",", "");

describe("the regression itself: a promise made while OPEN is not instantly overdue", () => {
  it("a Tuesday 10am callback is due at Tuesday close, not at 10am", () => {
    const now = new Date("2026-09-22T14:00:00Z"); // Tue 10:00 ET
    expect(local(now)).toBe("Tue 10:00");

    const due = nextCloseAt(now, TZ, HOURS);
    expect(local(due)).toBe("Tue 18:00");
    // THE REGRESSION IN ONE LINE. The old implementation used nextOpenAt, which
    // returns `now` during open hours — so this equality held, and the promise
    // was overdue a second after it was made.
    expect(due!.getTime()).not.toBe(now.getTime());
    expect(due!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("gives the promise real time to be kept — hours, not seconds", () => {
    const now = new Date("2026-09-22T14:00:00Z"); // Tue 10:00 ET
    const due = nextCloseAt(now, TZ, HOURS)!;
    const hours = (due.getTime() - now.getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(8, 1);
  });

  it("a late-afternoon call still gets the remainder of the day, never a past time", () => {
    const now = new Date("2026-09-22T21:30:00Z"); // Tue 17:30 ET, 30m before close
    const due = nextCloseAt(now, TZ, HOURS)!;
    expect(local(due)).toBe("Tue 18:00");
    expect(due.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("closed hours roll to the close of the next day the shop can act", () => {
  it("a 2am Tuesday call is due at Tuesday close", () => {
    const now = new Date("2026-09-22T06:00:00Z"); // Tue 02:00 ET
    expect(local(nextCloseAt(now, TZ, HOURS))).toBe("Tue 18:00");
  });

  it("an after-close Tuesday call rolls to WEDNESDAY close, not Wednesday open", () => {
    const now = new Date("2026-09-23T01:00:00Z"); // Tue 21:00 ET
    const due = nextCloseAt(now, TZ, HOURS)!;
    expect(local(due)).toBe("Wed 18:00");
    // Explicitly not 08:00: the deadline is the close of the day the shop can
    // next act, not the moment it becomes able to.
    expect(local(due)).not.toBe("Wed 08:00");
  });

  it("Sunday is closed, so a Sunday call is due at MONDAY close", () => {
    const now = new Date("2026-09-20T16:00:00Z"); // Sun 12:00 ET
    expect(local(nextCloseAt(now, TZ, HOURS))).toBe("Mon 18:00");
  });

  it("SKIPS a day with no hours — Sunday evening lands on Monday, not Sunday", () => {
    const now = new Date("2026-09-20T22:00:00Z"); // Sun 18:00 ET
    expect(local(nextCloseAt(now, TZ, HOURS))).toBe("Mon 18:00");
  });

  it("Saturday keeps its OWN shorter hours — 16:00, not the weekday 18:00", () => {
    // The bug this catches is reading a single hardcoded close time instead of
    // the close of the day the schedule walk actually landed on.
    const now = new Date("2026-09-19T15:00:00Z"); // Sat 11:00 ET
    expect(local(now)).toBe("Sat 11:00");
    expect(local(nextCloseAt(now, TZ, HOURS))).toBe("Sat 16:00");
  });

  it("Saturday night rolls past closed Sunday to Monday close", () => {
    const now = new Date("2026-09-20T02:00:00Z"); // Sat 22:00 ET
    expect(local(nextCloseAt(now, TZ, HOURS))).toBe("Mon 18:00");
  });
});

describe("DST — the deadline is a LOCAL closing time on both sides of the change", () => {
  // These cover the shiftLocalMinutes correction. Adding raw milliseconds across
  // a clock change lands an hour off, which would move every deadline in the
  // week after a DST boundary.
  it("lands on 18:00 local across the US fall-back boundary", () => {
    // US DST ends Sun 2026-11-01. Sat 2026-10-31 18:00 ET is after Saturday's
    // 16:00 close, so the walk crosses the change to Monday 2026-11-02 EST.
    const now = new Date("2026-10-31T22:00:00Z"); // 18:00 EDT Sat
    const due = nextCloseAt(now, TZ, HOURS)!;
    expect(local(due)).toContain("Mon");
    expect(local(due)).toContain("18:00");
  });

  it("lands on 18:00 local across the US spring-forward boundary", () => {
    // US DST begins Sun 2026-03-08. Sat 2026-03-07 18:00 EST → Monday EDT.
    const now = new Date("2026-03-07T23:00:00Z"); // 18:00 EST Sat
    const due = nextCloseAt(now, TZ, HOURS)!;
    expect(local(due)).toContain("Mon");
    expect(local(due)).toContain("18:00");
  });
});

describe("it refuses rather than inventing", () => {
  it("no hours at all yields null, not a fabricated deadline", () => {
    expect(nextCloseAt(new Date("2026-09-22T14:00:00Z"), TZ, {})).toBeNull();
  });

  it("only unparseable hours yields null, not a silent default", () => {
    expect(nextCloseAt(new Date("2026-09-22T14:00:00Z"), TZ, { tuesday: "whenever" })).toBeNull();
  });
});

describe("POSITIVE CONTROL", () => {
  it("the result is always STRICTLY after now — the whole point", () => {
    // A function that returned `now`, or that returned a constant, would pass
    // individual cases above. This is the invariant that kills both.
    const instants = [
      "2026-09-22T06:00:00Z", // Tue 02:00 closed
      "2026-09-22T14:00:00Z", // Tue 10:00 open
      "2026-09-22T21:30:00Z", // Tue 17:30 open, near close
      "2026-09-23T01:00:00Z", // Tue 21:00 after close
      "2026-09-19T15:00:00Z", // Sat 11:00 open
      "2026-09-20T16:00:00Z", // Sun 12:00 closed
    ];
    for (const iso of instants) {
      const now = new Date(iso);
      const due = nextCloseAt(now, TZ, HOURS);
      expect(due, iso).not.toBeNull();
      expect(due!.getTime(), `${iso} must be strictly in the future`).toBeGreaterThan(now.getTime());
    }
  });

  it("different inputs produce different deadlines", () => {
    // Guards a function hardcoded to one close time.
    const a = nextCloseAt(new Date("2026-09-22T14:00:00Z"), TZ, HOURS)!; // Tue
    const b = nextCloseAt(new Date("2026-09-19T15:00:00Z"), TZ, HOURS)!; // Sat
    expect(a.getTime()).not.toBe(b.getTime());
  });

  it("while OPEN, the deadline is never the promise instant", () => {
    // The regression as a property rather than by naming the old function: if
    // the deadline ever equals `now` again, every promise made during business
    // hours is overdue immediately.
    for (const iso of ["2026-09-22T14:00:00Z", "2026-09-19T15:00:00Z"]) {
      const now = new Date(iso);
      expect(nextCloseAt(now, TZ, HOURS)!.getTime(), iso).not.toBe(now.getTime());
    }
  });
});
