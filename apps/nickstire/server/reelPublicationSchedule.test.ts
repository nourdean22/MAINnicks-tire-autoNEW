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
 * These tests pin the two properties that make the intent trustworthy: it lands
 * on the policy's real slots, and it is never in the past.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REEL_SCHEDULE_LIMITS,
  SHOP_TIME_ZONE,
  dailySlotHoursEt,
  etDateOf,
  etWallClockToInstant,
  planReelPublicationSlots,
  reelPublicationIntentFor,
} from "../shared/reelPublicationSchedule";

/** The ET wall-clock hour an instant reads as. */
function etHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: SHOP_TIME_ZONE, hour12: false, hour: "2-digit" })
      .format(at)
      .replace(/\D/g, ""),
  );
}

describe("the cadence comes from the policy, not a hardcoded pair of times", () => {
  it("lays out exactly maxFeedPostsPerDay slots, spaced by the policy gap", () => {
    const hours = dailySlotHoursEt();
    expect(hours).toHaveLength(DEFAULT_REEL_SCHEDULE_LIMITS.maxFeedPostsPerDay);
    for (let i = 1; i < hours.length; i++) {
      expect(hours[i] - hours[i - 1]).toBe(DEFAULT_REEL_SCHEDULE_LIMITS.minHoursBetweenFeedPosts);
    }
  });

  it("tracks a changed policy instead of ignoring it", () => {
    // The point of deriving rather than hardcoding: raise the cap and the
    // schedule widens on its own.
    const hours = dailySlotHoursEt({ maxFeedPostsPerDay: 4, minHoursBetweenFeedPosts: 2, firstSlotHourEt: 9 });
    expect(hours).toEqual([9, 11, 13, 15]);
  });

  it("drops a slot that would fall after the shop day rather than wrapping it", () => {
    // Wrapping would schedule a post at 2am and look like a valid slot.
    const hours = dailySlotHoursEt({ maxFeedPostsPerDay: 6, minHoursBetweenFeedPosts: 5, firstSlotHourEt: 9 });
    expect(hours).toEqual([9, 14, 19]);
    expect(Math.max(...hours)).toBeLessThanOrEqual(20);
  });
});

describe("America/New_York is the clock, in both halves of the year", () => {
  it("holds the 09:00 ET slot across the DST boundary", () => {
    // The trap this rules out: computing in UTC drifts the slot by an hour for
    // five months, so a "9am" post goes out at 8am or 10am half the year.
    const summer = etWallClockToInstant(2026, 7, 15, 9);
    const winter = etWallClockToInstant(2026, 1, 15, 9);
    expect(etHour(summer)).toBe(9);
    expect(etHour(winter)).toBe(9);
    // And they really are different UTC offsets - otherwise the assertion above
    // would pass on a zone that never shifts.
    expect(summer.getUTCHours()).not.toBe(winter.getUTCHours());
  });

  it("round-trips an ET date through the instant it names", () => {
    const at = etWallClockToInstant(2026, 3, 8, 9); // US spring-forward day
    expect(etDateOf(at)).toEqual({ year: 2026, month1: 3, day: 8 });
    expect(etHour(at)).toBe(9);
  });
});

/** 11:00 ET - deliberately PAST the 09:00 slot, so "skips what already passed"
 *  is exercised rather than assumed. Shared by the last two blocks. */
const start = etWallClockToInstant(2026, 9, 8, 11);

describe("a plan is reachable — never a deadline already missed", () => {
  it("skips today's slots that have already passed", () => {
    const slots = planReelPublicationSlots(3, start);
    for (const s of slots) expect(s.dueAt.getTime()).toBeGreaterThan(start.getTime());
    // 09:00 is gone; 12:00 today is the first reachable one.
    expect(etHour(slots[0].dueAt)).toBe(12);
    expect(slots[0].dayOffset).toBe(0);
  });

  it("rolls to the next day once the day's slots are used", () => {
    const slots = planReelPublicationSlots(4, start);
    expect(slots.map((s) => s.dayOffset)).toEqual([0, 1, 1, 2]);
    expect(slots.map((s) => etHour(s.dueAt))).toEqual([12, 9, 12, 9]);
  });

  it("is strictly increasing — two reels never share an instant", () => {
    const slots = planReelPublicationSlots(40, start);
    expect(slots).toHaveLength(40);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].dueAt.getTime()).toBeGreaterThan(slots[i - 1].dueAt.getTime());
    }
  });

  it("takes the whole rotation the number of days the cap implies", () => {
    // 99 reels at 2/day is ~50 days. This is the number that makes the cadence
    // legible to an operator, so it is asserted rather than described.
    const slots = planReelPublicationSlots(99, start);
    expect(slots).toHaveLength(99);
    expect(slots[98].dayOffset).toBe(49);
  });
});

describe("what must NOT change", () => {
  it("returns null rather than a fabricated date when nothing can be scheduled", () => {
    // A caller with no slots must get an absent intent, not a wrong one - null
    // is a legitimate value meaning "no deadline declared".
    const none = planReelPublicationSlots(5, new Date(), { maxFeedPostsPerDay: 0, minHoursBetweenFeedPosts: 3, firstSlotHourEt: 9 });
    expect(none).toEqual([]);
    expect(reelPublicationIntentFor(0, new Date(), { maxFeedPostsPerDay: 0, minHoursBetweenFeedPosts: 3, firstSlotHourEt: 9 })).toBeNull();
  });

  it("position 0 is the first reachable slot, so an enqueue is never born late", () => {
    const at = reelPublicationIntentFor(0, start);
    expect(at).not.toBeNull();
    expect(at!.getTime()).toBeGreaterThan(start.getTime());
  });

  it("the schedule is PURE — same inputs, same answer, no clock read", () => {
    // A hidden `new Date()` would make the intent unreproducible and untestable.
    const a = planReelPublicationSlots(6, start).map((s) => s.dueAt.toISOString());
    const b = planReelPublicationSlots(6, start).map((s) => s.dueAt.toISOString());
    expect(a).toEqual(b);
  });
});
