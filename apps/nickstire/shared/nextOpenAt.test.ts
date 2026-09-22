/**
 * `nextOpenAt` — a promise deadline may be DERIVED, never invented.
 *
 * The Promise Ledger scores kept-vs-missed against `due_at`. A fabricated due
 * time therefore manufactures a breach the shop never agreed to, which is worse
 * than recording no promise at all. This function's whole contract is: return a
 * real instant derived from the shop's own configured hours, or return null and
 * let the caller decline to promise.
 *
 * Hours are the SAME `BUSINESS.hours.structured` that `businessState` reads, so
 * there is no second definition of "when we open".
 */
import { describe, expect, it } from "vitest";

import { nextOpenAt } from "./shopState";

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

/** Build an instant from a local ET wall-clock time. */
const et = (iso: string) => new Date(iso);

/** Read back the local wall clock so assertions are in shop time, not UTC. */
function localHM(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

describe("while OPEN, the next open moment is now", () => {
  it("returns the same instant during business hours", () => {
    // Wed 2026-09-16 14:00 ET
    const now = et("2026-09-16T18:00:00Z");
    expect(nextOpenAt(now, TZ, HOURS)?.getTime()).toBe(now.getTime());
  });
});

describe("closed BEFORE open, it opens later the same day", () => {
  it("6am Wednesday → 8am Wednesday", () => {
    const now = et("2026-09-16T10:00:00Z"); // 06:00 ET Wed
    const got = nextOpenAt(now, TZ, HOURS);
    expect(localHM(got!)).toContain("08:00");
    expect(localHM(got!)).toContain("Wed");
  });
});

describe("closed AFTER close, it rolls to the next day with hours", () => {
  it("8pm Wednesday → 8am Thursday", () => {
    const now = et("2026-09-17T00:00:00Z"); // 20:00 ET Wed
    const got = nextOpenAt(now, TZ, HOURS);
    expect(localHM(got!)).toContain("08:00");
    expect(localHM(got!)).toContain("Thu");
  });

  it("SKIPS a day with no hours — Sun 6pm → Mon 8am", () => {
    // This is the case the old "before 6 PM today" SMS bug got wrong: Sunday
    // has no hours key at all, so the walk must step over it entirely.
    const now = et("2026-09-20T22:00:00Z"); // 18:00 ET SUNDAY
    const got = nextOpenAt(now, TZ, HOURS);
    expect(localHM(got!)).toContain("Mon");
    expect(localHM(got!)).toContain("08:00");
  });

  it("Sunday midday (no hours that day) → Monday 8am, not 'now'", () => {
    // Guards the branch order: a day with NO hours must not be mistaken for
    // an open day just because there is no close time to compare against.
    const now = et("2026-09-20T16:00:00Z"); // 12:00 ET SUNDAY
    const got = nextOpenAt(now, TZ, HOURS);
    expect(localHM(got!)).toContain("Mon");
    expect(localHM(got!)).toContain("08:00");
  });

  it("uses SATURDAY's different open time, not the weekday one", () => {
    // Fri 8pm → Sat 09:00, proving per-day hours are read rather than a single
    // weekday open time being assumed for the whole week.
    const friNight = et("2026-09-19T00:00:00Z"); // 20:00 ET FRIDAY
    const sat = nextOpenAt(friNight, TZ, HOURS);
    expect(localHM(sat!)).toContain("Sat");
    expect(localHM(sat!)).toContain("09:00");
  });

  it("Saturday evening rolls over Sunday to Monday 8am", () => {
    const satNight = et("2026-09-19T23:00:00Z"); // 19:00 ET SATURDAY, after 16:00 close
    const got = nextOpenAt(satNight, TZ, HOURS);
    expect(localHM(got!)).toContain("Mon");
    expect(localHM(got!)).toContain("08:00");
  });
});

describe("it returns NULL rather than fabricating a deadline", () => {
  it("no hours configured at all → null", () => {
    expect(nextOpenAt(et("2026-09-16T18:00:00Z"), TZ, {})).toBeNull();
  });

  it("only unparseable hours → null, not a silent default", () => {
    // A malformed range must not fall through to "8am tomorrow".
    expect(nextOpenAt(et("2026-09-16T18:00:00Z"), TZ, { monday: "not-a-range" })).toBeNull();
  });
});

describe("DST — the shop opens at 8:00 local either side of the change", () => {
  it("lands on 08:00 local across the US fall-back boundary", () => {
    // US DST ends Sun 2026-11-01. Sat 2026-10-31 18:00 ET is after Saturday's
    // 16:00 close, so the next open is Monday 2026-11-02 08:00 EST — a jump
    // that crosses the clock change. Adding raw milliseconds lands at 07:00.
    const now = et("2026-10-31T22:00:00Z"); // 18:00 EDT Sat
    const got = nextOpenAt(now, TZ, HOURS);
    expect(localHM(got!)).toContain("Mon");
    expect(localHM(got!)).toContain("08:00");
  });

  it("lands on 08:00 local across the US spring-forward boundary", () => {
    // US DST begins Sun 2026-03-08. Sat 2026-03-07 18:00 EST → Mon 08:00 EDT.
    const now = et("2026-03-07T23:00:00Z"); // 18:00 EST Sat
    const got = nextOpenAt(now, TZ, HOURS);
    expect(localHM(got!)).toContain("Mon");
    expect(localHM(got!)).toContain("08:00");
  });
});

describe("the contract", () => {
  it("POSITIVE CONTROL: it returns DIFFERENT instants for different inputs", () => {
    // Without this, a function hardcoded to return `now` would satisfy the
    // open-hours case and a function hardcoded to null would satisfy the
    // unconfigured cases. Neither would be deriving anything.
    const a = nextOpenAt(et("2026-09-16T10:00:00Z"), TZ, HOURS); // Wed 06:00 → Wed 08:00
    const b = nextOpenAt(et("2026-09-17T00:00:00Z"), TZ, HOURS); // Wed 20:00 → Thu 08:00
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.getTime()).not.toBe(b!.getTime());
  });

  it("never returns an instant in the past", () => {
    for (const iso of [
      "2026-09-16T10:00:00Z", // Wed 06:00, before open
      "2026-09-17T00:00:00Z", // Wed 20:00, after close
      "2026-09-20T22:00:00Z", // Sun 18:00, closed day
      "2026-09-21T16:00:00Z", // Mon 12:00, open
    ]) {
      const now = et(iso);
      const got = nextOpenAt(now, TZ, HOURS);
      expect(got!.getTime()).toBeGreaterThanOrEqual(now.getTime());
    }
  });
});
