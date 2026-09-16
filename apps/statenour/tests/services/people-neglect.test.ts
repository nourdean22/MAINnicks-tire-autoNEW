/**
 * "Neglected" is one reachable definition (2026-09-16, W8).
 *
 * The three hand-rolled copies this replaced all required
 * `interactionCount >= 3`, written while the counter was inflated by chat
 * mentions (it ran to 69). After the 2026-09-16 reconcile the honest prod
 * figures are: 20 live profiles · 7 ever logged · max count 4 · `>= 3`
 * matches 2. So the filter dropped 5 of the 7 real candidates, and dropped
 * the worst cases first — a person logged ONCE and then untouched for months
 * is the clearest neglect there is.
 *
 * Case 1 below is the positive control for that repair: restore
 * MIN_LOGGED_CONTACTS to 3 in lib/services/people/neglect.ts and it goes red.
 * Case 4 is the control for the other half — never-logged people must stay
 * out, or the surface would cry neglect over 13 profiles it has never seen.
 */
import { describe, expect, it } from "vitest";

import {
  MIN_LOGGED_CONTACTS,
  NEGLECT_AFTER_DAYS,
  daysSinceContact,
  isNeglected,
} from "@/lib/services/people/neglect";

const NOW = new Date("2026-09-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("isNeglected", () => {
  it("ONE logged contact is enough — the case `>= 3` silently dropped", () => {
    expect(isNeglected({ interactionCount: 1, lastInteraction: daysAgo(60) }, NOW)).toBe(true);
    expect(isNeglected({ interactionCount: 2, lastInteraction: daysAgo(30) }, NOW)).toBe(true);
  });

  it("a person contacted inside the window is not neglected", () => {
    expect(isNeglected({ interactionCount: 4, lastInteraction: daysAgo(1) }, NOW)).toBe(false);
    expect(isNeglected({ interactionCount: 4, lastInteraction: daysAgo(13) }, NOW)).toBe(false);
  });

  it("the boundary is inclusive and has ONE spelling", () => {
    // The old copies disagreed here: the brain compared a Date against
    // daysAgo(14) while the route compared a ROUNDED day count against > 14,
    // so 14.4 days quiet was neglected on one surface and not the other.
    expect(isNeglected({ interactionCount: 1, lastInteraction: daysAgo(NEGLECT_AFTER_DAYS) }, NOW)).toBe(true);
    expect(isNeglected({ interactionCount: 1, lastInteraction: daysAgo(NEGLECT_AFTER_DAYS - 1) }, NOW)).toBe(false);
    // 14.4 days: floor() puts it at 14, neglected, on every surface.
    expect(isNeglected({ interactionCount: 1, lastInteraction: daysAgo(14.4) }, NOW)).toBe(true);
  });

  it("never-logged is NOT neglected — 13 of 20 live profiles are in that state", () => {
    expect(isNeglected({ interactionCount: 0, lastInteraction: null }, NOW)).toBe(false);
    // A date with a zero count is the same claim: no contact on record.
    expect(isNeglected({ interactionCount: 0, lastInteraction: daysAgo(900) }, NOW)).toBe(false);
  });

  it("accepts the ISO string shape the API layer carries, and rejects garbage", () => {
    expect(isNeglected({ interactionCount: 1, lastInteraction: daysAgo(40).toISOString() }, NOW)).toBe(true);
    expect(daysSinceContact({ interactionCount: 1, lastInteraction: "not a date" }, NOW)).toBeNull();
    expect(isNeglected({ interactionCount: 1, lastInteraction: "not a date" }, NOW)).toBe(false);
  });

  it("daysSinceContact floors rather than rounds, so the number shown matches the verdict", () => {
    // The badge renders this value beside the verdict; a rounded 14 beside a
    // not-neglected verdict (13.6 days) is the contradiction this avoids.
    expect(daysSinceContact({ interactionCount: 1, lastInteraction: daysAgo(13.6) }, NOW)).toBe(13);
    expect(daysSinceContact({ interactionCount: 1, lastInteraction: null }, NOW)).toBeNull();
  });

  it("the threshold stays reachable against the measured live distribution", () => {
    // Measured on prod 2026-09-16: max interactionCount = 4. A minimum above
    // that is a dead rule, which is exactly how `>= 3` half-died. This fails
    // loudly if someone raises it past what the data can produce.
    const MEASURED_MAX_INTERACTION_COUNT = 4;
    expect(MIN_LOGGED_CONTACTS).toBeLessThanOrEqual(MEASURED_MAX_INTERACTION_COUNT);
    expect(MIN_LOGGED_CONTACTS).toBeGreaterThanOrEqual(1);
  });
});
