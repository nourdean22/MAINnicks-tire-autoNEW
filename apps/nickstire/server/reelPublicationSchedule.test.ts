/**
 * `publication_intended_at` finally has a writer, and the schedule that fills it
 * is the policy's cadence rather than a guess.
 *
 * Migration 0118 shipped the column and `reelRecoveryLedger` READS it, but
 * nothing in the repo ever wrote one - the classic reader-with-no-writer. Every
 * job's intent was null, so "was this reel late?" had nothing to compare
 * against, and the 0118 comment distinguishing DUE-AT from
 * `publicationScheduledAt` ("publish STARTED") described a difference no row
 * could express.
 *
 * DRIVEN THROUGH `reelPublicationIntentFor`, the module's only export. An
 * earlier version reached into six internal helpers; the orphan gate flagged
 * them and was right - exporting a helper so a test can touch it makes the test
 * prove something production never asks. Everything here goes through the
 * function the cron actually calls, passing custom limits where the cadence
 * itself is the subject.
 */
import { describe, expect, it } from "vitest";
import { reelPublicationIntentFor } from "../shared/reelPublicationSchedule";

const ET = "America/New_York";

/** The ET wall-clock hour an instant reads as. */
function etHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: ET, hour12: false, hour: "2-digit" })
      .format(at)
      .replace(/\D/g, ""),
  );
}

/** The ET calendar date an instant reads as, as YYYY-MM-DD. */
function etDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The first `n` intents from one start, in order. */
function plan(n: number, start: Date, limits?: Parameters<typeof reelPublicationIntentFor>[2]): Date[] {
  return Array.from({ length: n }, (_, i) => reelPublicationIntentFor(i, start, limits)).filter(Boolean) as Date[];
}

/** 2026-09-08 15:00Z = 11:00 ET. Deliberately PAST the 09:00 slot so the
 *  "skips what already passed" behaviour is exercised rather than assumed, and
 *  deliberately NOT exactly on a slot: the planner requires an intent strictly
 *  in the future, so a fixture sitting on 12:00 would push the first slot to
 *  tomorrow and hide today's. */
const START = new Date("2026-09-08T15:00:00Z");

describe("the cadence comes from the policy, not a hardcoded pair of times", () => {
  it("places exactly maxFeedPostsPerDay posts a day, spaced by the policy gap", () => {
    const first4 = plan(4, START);
    // Two per day at the default policy: today's remaining slot, then two
    // tomorrow, then the next day's first.
    expect(first4.map(etDay)).toEqual(["2026-09-08", "2026-09-09", "2026-09-09", "2026-09-10"]);
    expect(etHour(first4[1])).toBe(9);
    expect(etHour(first4[2]) - etHour(first4[1])).toBe(3);
  });

  it("tracks a changed policy instead of ignoring it", () => {
    // The point of deriving rather than hardcoding: raise the cap and more
    // posts fit into the same day.
    const limits = { maxFeedPostsPerDay: 4, minHoursBetweenFeedPosts: 2, firstSlotHourEt: 9 };
    const day2 = plan(6, START, limits).filter((d) => etDay(d) === "2026-09-09");
    expect(day2.map(etHour)).toEqual([9, 11, 13, 15]);
  });

  it("drops a slot past the shop day rather than wrapping it to 2am", () => {
    // Wrapping would publish after hours and still look like a valid slot.
    const limits = { maxFeedPostsPerDay: 6, minHoursBetweenFeedPosts: 5, firstSlotHourEt: 9 };
    const day2 = plan(8, START, limits).filter((d) => etDay(d) === "2026-09-09");
    expect(day2.map(etHour)).toEqual([9, 14, 19]);
    for (const d of plan(8, START, limits)) expect(etHour(d)).toBeLessThanOrEqual(20);
  });
});

describe("America/New_York is the clock, in both halves of the year", () => {
  it("holds the 09:00 ET slot across BOTH DST transitions", () => {
    // The trap this rules out: computing in UTC drifts the slot by an hour for
    // five months, so a "9am" post goes out at 8am or 10am half the year.
    const summer = reelPublicationIntentFor(0, new Date("2026-07-15T05:00:00Z"))!;
    const winter = reelPublicationIntentFor(0, new Date("2026-01-15T05:00:00Z"))!;
    expect(etHour(summer)).toBe(9);
    expect(etHour(winter)).toBe(9);
    // And the two really do sit at different UTC offsets - otherwise the
    // assertions above would pass on a zone that never shifts.
    expect(summer.getUTCHours()).not.toBe(winter.getUTCHours());
  });

  it("lands 09:00 ET on the spring-forward day itself", () => {
    const at = reelPublicationIntentFor(0, new Date("2026-03-08T05:00:00Z"))!;
    expect(etDay(at)).toBe("2026-03-08");
    expect(etHour(at)).toBe(9);
  });
});

describe("a plan is reachable — never a deadline already missed", () => {
  it("skips today's slots that have already passed", () => {
    // 09:00 ET is gone at an 11:00 ET start, so the first reachable slot is today's 12:00.
    const first = reelPublicationIntentFor(0, START)!;
    expect(first.getTime()).toBeGreaterThan(START.getTime());
    expect(etDay(first)).toBe("2026-09-08");
    expect(etHour(first)).toBe(12);
  });

  it("is strictly increasing — two reels never share an instant", () => {
    const slots = plan(40, START);
    expect(slots).toHaveLength(40);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].getTime()).toBeGreaterThan(slots[i - 1].getTime());
    }
  });

  it("takes the whole rotation the number of days the cap implies", () => {
    // 99 reels at 2/day is 50 days. This is the number that makes the cadence
    // legible to an operator, so it is asserted rather than described.
    const slots = plan(99, START);
    expect(slots).toHaveLength(99);
    expect(etDay(slots[0])).toBe("2026-09-08");
    expect(etDay(slots[98])).toBe("2026-10-27");
  });
});

describe("what must NOT change", () => {
  it("returns null rather than a fabricated date when nothing can be scheduled", () => {
    // A caller with no slots must get an absent intent, not a wrong one - null
    // is a legitimate value meaning "no deadline declared".
    expect(
      reelPublicationIntentFor(0, START, { maxFeedPostsPerDay: 0, minHoursBetweenFeedPosts: 3, firstSlotHourEt: 9 }),
    ).toBeNull();
  });

  it("position 0 is the first reachable slot, so an enqueue is never born late", () => {
    for (const start of [START, new Date("2026-12-31T23:30:00Z"), new Date("2026-06-01T13:00:00Z")]) {
      const at = reelPublicationIntentFor(0, start);
      expect(at, `no intent for ${start.toISOString()}`).not.toBeNull();
      expect(at!.getTime()).toBeGreaterThan(start.getTime());
    }
  });

  it("is PURE — same inputs, same answer, no clock read", () => {
    // A hidden Date.now() would make the intent unreproducible and untestable.
    expect(plan(6, START).map((d) => d.toISOString())).toEqual(plan(6, START).map((d) => d.toISOString()));
  });
});
