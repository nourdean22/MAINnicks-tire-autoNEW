/**
 * When a reel is DUE to publish — the writer `publication_intended_at` never had.
 *
 * Migration 0118 added the column and documented the distinction it exists for:
 * `publicationScheduledAt` is stamped at the publish CAS and therefore means
 * "publish STARTED", while `publicationIntendedAt` means "DUE AT". The column
 * shipped, `reelRecoveryLedger` READS it, and nothing in the repo ever wrote
 * one — so every job's intent was null and "when was this supposed to go out?"
 * had no answer to compare against.
 *
 * This module is the missing half. It is deliberately PURE and timezone-explicit
 * so the schedule can be computed, asserted and printed without a database.
 *
 * THE CADENCE IS THE POLICY'S, NOT A GUESS. `autonomyPolicy` caps feed posts at
 * `maxFeedPostsPerDay` and spaces them by `minHoursBetweenFeedPosts`; publishing
 * faster than that is refused downstream by the reservation guard, so a schedule
 * that ignored those limits would generate intents the pipeline could never
 * honour. Slots are laid out from those two numbers rather than hardcoded.
 *
 * EVERYTHING IS AMERICA/NEW_YORK. The shop runs on Cleveland time, the daily
 * reel windows are ET, and a UTC-based day boundary silently shifts a post to
 * the wrong day for five months of the year.
 */

/** Cleveland. Every boundary in this module is computed in this zone. */
const SHOP_TIME_ZONE = "America/New_York";

export interface ReelScheduleLimits {
  /** `autonomyPolicy.limits.maxFeedPostsPerDay`. */
  maxFeedPostsPerDay: number;
  /** Hours between two feed posts on the same day. */
  minHoursBetweenFeedPosts: number;
  /** First slot of the day, as an ET hour (24h). */
  firstSlotHourEt: number;
}

const DEFAULT_REEL_SCHEDULE_LIMITS: ReelScheduleLimits = {
  maxFeedPostsPerDay: 2,
  minHoursBetweenFeedPosts: 3,
  // 09:00 ET puts the first post before the morning commute ends and leaves
  // room for the second inside business hours at any legal spacing.
  firstSlotHourEt: 9,
};

/** The ET wall-clock hours a day's posts are due at, earliest first. */
function dailySlotHoursEt(limits: ReelScheduleLimits = DEFAULT_REEL_SCHEDULE_LIMITS): number[] {
  const { maxFeedPostsPerDay, minHoursBetweenFeedPosts, firstSlotHourEt } = limits;
  const slots: number[] = [];
  for (let i = 0; i < Math.max(0, maxFeedPostsPerDay); i++) {
    const hour = firstSlotHourEt + i * minHoursBetweenFeedPosts;
    // A slot that would fall past the shop day is dropped rather than wrapped:
    // wrapping would silently publish after hours, and dropping is visible in
    // the returned length.
    if (hour > 20) break;
    slots.push(hour);
  }
  return slots;
}

/** UTC offset in minutes for the shop zone at a given instant (handles DST). */
function shopOffsetMinutes(at: Date): number {
  // Intl gives the zone's wall clock; the difference from the same instant read
  // as UTC is the offset. This is DST-correct by construction because Intl
  // resolves the rule for THAT instant rather than applying a fixed number.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - at.getTime()) / 60000;
}

/**
 * The instant an ET wall-clock time falls at.
 *
 * Resolved in two passes: guess with the offset at the naive instant, then
 * re-read the offset AT that guess and correct. One correction is enough for
 * every real case because the offset only moves by an hour, and it is what
 * keeps a 09:00 slot at 09:00 across both DST transitions instead of drifting
 * to 08:00 or 10:00 for half the year.
 */
function etWallClockToInstant(year: number, month1: number, day: number, hourEt: number): Date {
  const naive = Date.UTC(year, month1 - 1, day, hourEt, 0, 0);
  const firstGuess = new Date(naive - shopOffsetMinutes(new Date(naive)) * 60000);
  return new Date(naive - shopOffsetMinutes(firstGuess) * 60000);
}

/** The ET calendar date `n` days after an ET date, as {year, month1, day}. */
function addEtDays(year: number, month1: number, day: number, n: number): { year: number; month1: number; day: number } {
  // Midday avoids any DST edge when stepping whole days.
  const d = new Date(Date.UTC(year, month1 - 1, day + n, 12, 0, 0));
  return { year: d.getUTCFullYear(), month1: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The ET calendar date an instant falls on. */
function etDateOf(at: Date): { year: number; month1: number; day: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: SHOP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(at)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return { year: Number(parts.year), month1: Number(parts.month), day: Number(parts.day) };
}

interface ScheduledReelSlot {
  /** 0-based position in the publication queue. */
  position: number;
  /** Whole days after the start date this lands on. */
  dayOffset: number;
  /** Which slot within that day (0 = first). */
  slotOfDay: number;
  /** ET wall-clock hour the post is due. */
  hourEt: number;
  /** The instant it is due — what goes into `publication_intended_at`. */
  dueAt: Date;
}

/**
 * Lay `count` publications onto the policy's slots, starting from `startAt`'s
 * ET date, and never scheduling anything in the past.
 *
 * Position 0 takes the first slot that is still in the future, so re-running on
 * a later day does not produce intents that were already missed.
 */
function planReelPublicationSlots(
  count: number,
  startAt: Date,
  limits: ReelScheduleLimits = DEFAULT_REEL_SCHEDULE_LIMITS,
): ScheduledReelSlot[] {
  const hours = dailySlotHoursEt(limits);
  if (hours.length === 0 || count <= 0) return [];

  const startDate = etDateOf(startAt);
  const out: ScheduledReelSlot[] = [];
  let dayOffset = 0;
  let slotOfDay = 0;

  // Skip the slots that have already passed TODAY, so the first intent is
  // always reachable rather than instantly overdue.
  while (out.length < count) {
    const d = addEtDays(startDate.year, startDate.month1, startDate.day, dayOffset);
    const hourEt = hours[slotOfDay];
    const dueAt = etWallClockToInstant(d.year, d.month1, d.day, hourEt);
    if (dueAt.getTime() > startAt.getTime()) {
      out.push({ position: out.length, dayOffset, slotOfDay, hourEt, dueAt });
    }
    slotOfDay += 1;
    if (slotOfDay >= hours.length) {
      slotOfDay = 0;
      dayOffset += 1;
    }
    // Guard against an unreachable configuration (every slot in the past and
    // no day advance) rather than looping forever.
    if (dayOffset > count + 366) break;
  }
  return out;
}

/**
 * The due instant for a single position — the module's ONLY export.
 *
 * Everything above is internal. The orphan gate flagged six exports nothing
 * outside this file consumed, and it was right: exporting a helper so a test
 * can reach it makes the test prove something production never asks. The suite
 * drives this function instead, passing custom limits where it needs to observe
 * the cadence, which exercises the real path rather than a private corner of it.
 */
export function reelPublicationIntentFor(
  position: number,
  startAt: Date,
  limits: ReelScheduleLimits = DEFAULT_REEL_SCHEDULE_LIMITS,
): Date | null {
  const slots = planReelPublicationSlots(position + 1, startAt, limits);
  return slots[position]?.dueAt ?? null;
}
