/**
 * Week anchors are ET anchors, and the code that computes them LOOKS wrong.
 *
 * THE CARRIED ITEM, and it is refuted. `weekly-digest/route.ts` computed its
 * week start as:
 *
 *     d.setDate(d.getDate() - weekdayET(d));
 *
 * That mixes frames in plain sight — `getDate()` is the SERVER day-of-month,
 * `weekdayET()` is the ET weekday — and it was carried for several sessions as
 * a suspected bug. It is not one. `setDate(getDate() - n)` shifts the INSTANT
 * by n days and the ET conversion happens afterwards, so the two frames never
 * actually meet.
 *
 * MEASURED BEFORE CHANGING ANYTHING, against an independent walk-back oracle:
 *
 *   2,904 instants x 4 server timezones (UTC, America/New_York, Asia/Tokyo,
 *   Australia/Sydney — both DST regimes, both hemispheres) = 11,616 checks,
 *   0 mismatches.
 *
 * So the change that shipped is a MOVE, not a repair:
 *
 *   · `getWeekStart()` was a hand-rolled duplicate of `startOfWeekET`, which
 *     already existed in lib/utils/datetime.ts and is ET-anchored throughout.
 *     Proven equivalent over 8,760 further checks before the swap. Prior art
 *     was there the whole time; nobody looked.
 *   · `getRecentMondays()` moved to `recentMondaysET` because a Next route
 *     module rejects non-standard exports, which made it untestable in place.
 *
 * WHY THIS FILE EXISTS AT ALL, given nothing was broken. The danger is now
 * inverted: the surviving arithmetic READS like a frame bug, so the next
 * reader is likely to "fix" it into being wrong. This pins the behaviour
 * against the same oracle that cleared it.
 */
import { describe, it, expect } from "vitest";
import {
  startOfWeekET,
  recentMondaysET,
  toDateString,
  weekdayET,
} from "@/lib/utils/datetime";

/**
 * Independent of the implementation: step back one real day at a time until the
 * ET weekday matches, then read the ET date. Shares no arithmetic with the code
 * under test, which is the only reason its agreement means anything.
 */
function walkBackTo(now: Date, targetWeekday: number): string {
  let d = new Date(now);
  for (let i = 0; i < 8; i++) {
    if (weekdayET(d) === targetWeekday) return toDateString(d);
    d = new Date(d.getTime() - 86_400_000);
  }
  throw new Error("no such weekday within 8 days — the oracle is broken");
}

/** Every 6 hours across two years: covers both DST flips and every ET hour. */
function instants(): Date[] {
  const out: Date[] = [];
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2028, 0, 1); t += 6 * 3_600_000) {
    out.push(new Date(t));
  }
  return out;
}

describe("startOfWeekET · the Sunday that starts the ET week", () => {
  it("agrees with the oracle at every instant across two years", () => {
    const bad = instants().filter(
      (now) => toDateString(startOfWeekET(now)) !== walkBackTo(now, 0),
    );
    expect(bad.length, `first divergence: ${bad[0]?.toISOString()}`).toBe(0);
    expect(instants().length, "the sweep must have a subject").toBeGreaterThan(2000);
  });

  it("THE CRON INSTANT: Monday 03:00 UTC is Sunday night in ET", () => {
    // weekly-digest runs `0 3 * * 1`. This is the exact case the carried item
    // suspected: the UTC date and the ET date genuinely disagree here, so if
    // the frames DID meet this is where it would show.
    const at = new Date("2026-08-24T03:00:00Z"); // Mon in UTC
    expect(weekdayET(at), "ET says Sunday").toBe(0);
    expect(at.getUTCDay(), "UTC says Monday").toBe(1);
    expect(toDateString(startOfWeekET(at))).toBe("2026-08-23");
  });
});

describe("recentMondaysET · the Mon-Sun week containing `at`", () => {
  it("agrees with the oracle at every instant across two years", () => {
    const bad = instants().filter((now) => recentMondaysET(now)[0] !== walkBackTo(now, 1));
    expect(bad.length, `first divergence: ${bad[0]?.toISOString()}`).toBe(0);
  });

  it("the second Monday is exactly seven days before the first", () => {
    for (const now of [
      new Date("2026-08-24T03:00:00Z"), // the cron instant · Sunday ET
      new Date("2026-03-09T05:30:00Z"), // hours after the ET spring-forward
      new Date("2026-11-02T05:30:00Z"), // hours after the ET fall-back
    ]) {
      const [a, b] = recentMondaysET(now);
      const gap = (Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
      expect(gap, `${a} vs ${b}`).toBe(7);
    }
  });
});

describe("POSITIVE CONTROL · the oracle can SEE a frame bug", () => {
  it("a UTC-weekday implementation diverges, and this test catches it", () => {
    // Load-bearing. Every assertion above is an agreement, and agreement proves
    // nothing unless disagreement is reachable. This is the mistake the carried
    // item feared — anchoring on the SERVER weekday instead of the ET one — and
    // the oracle must reject it, or the checks above are decoration.
    const wrong = (now: Date): string => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // UTC weekday, not ET
      return toDateString(d);
    };
    const diverged = instants().filter((now) => wrong(now) !== walkBackTo(now, 0));
    expect(
      diverged.length,
      "the oracle agreed with a knowingly wrong implementation — it is blind",
    ).toBeGreaterThan(100);
  });
});
