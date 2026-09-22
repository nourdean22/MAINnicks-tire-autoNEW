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
 */
import { describe, expect, it } from "vitest";

import { nextCloseAt, nextOpenAt } from "./shopState";

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

    // The defect, pinned so it cannot come back: nextOpenAt returns NOW here.
    expect(nextOpenAt(now, TZ, HOURS)?.getTime()).toBe(now.getTime());

    const due = nextCloseAt(now, TZ, HOURS);
    expect(local(due)).toBe("Tue 18:00");
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
    expect(local(nextOpenAt(now, TZ, HOURS))).toBe("Wed 08:00");
    expect(local(nextCloseAt(now, TZ, HOURS))).toBe("Wed 18:00");
  });

  it("Sunday is closed, so a Sunday call is due at MONDAY close", () => {
    const now = new Date("2026-09-20T16:00:00Z"); // Sun 12:00 ET
    expect(local(nextCloseAt(now, TZ, HOURS))).toBe("Mon 18:00");
  });

  it("Saturday keeps its OWN shorter hours — 16:00, not the weekday 18:00", () => {
    // The bug this catches is reading a single hardcoded close time instead of
    // the close of the day that nextOpenAt actually landed on.
    const now = new Date("2026-09-19T15:00:00Z"); // Sat 11:00 ET
    expect(local(now)).toBe("Sat 11:00");
    expect(local(nextCloseAt(now, TZ, HOURS))).toBe("Sat 16:00");
  });

  it("Saturday night rolls past closed Sunday to Monday close", () => {
    const now = new Date("2026-09-20T02:00:00Z"); // Sat 22:00 ET
    expect(local(nextCloseAt(now, TZ, HOURS))).toBe("Mon 18:00");
  });
});

describe("it refuses rather than inventing", () => {
  it("no hours at all yields null, not a fabricated deadline", () => {
    expect(nextCloseAt(new Date("2026-09-22T14:00:00Z"), TZ, {})).toBeNull();
  });

  it("an unparseable range yields null", () => {
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

  it("is genuinely DIFFERENT from nextOpenAt while the shop is open", () => {
    // The regression in one line: if these two ever agree during open hours,
    // the deadline is the instant of the promise again.
    const now = new Date("2026-09-22T14:00:00Z");
    expect(nextCloseAt(now, TZ, HOURS)!.getTime()).not.toBe(nextOpenAt(now, TZ, HOURS)!.getTime());
  });
});
