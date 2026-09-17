/**
 * Unit tests for resolveFomoEntries — guards the FomoTicker honesty rule:
 * it shows ONLY real server activity and NEVER fabricates. This test exists
 * so the old hardcoded fake bookings/reviews can't sneak back in.
 */
import { describe, it, expect } from "vitest";
import {
  resolveFomoEntries,
  formatAgo,
  MAX_FOMO_ENTRIES,
  MAX_ENTRY_AGE_MINUTES,
  type FomoEntry,
} from "../components/fomoEntries";

const entry = (i: number): FomoEntry => ({ type: "completed", message: `real job ${i}`, minutesAgo: i });
const aged = (minutesAgo: number): FomoEntry => ({ type: "review", message: "★★★★★ New 5-star review", minutesAgo });

describe("resolveFomoEntries", () => {
  it("returns [] when there is no real activity (undefined/null/empty)", () => {
    expect(resolveFomoEntries(undefined)).toEqual([]);
    expect(resolveFomoEntries(null)).toEqual([]);
    expect(resolveFomoEntries([])).toEqual([]);
  });

  it("passes real activity through unchanged", () => {
    const real = [entry(1), entry(2), entry(3)];
    expect(resolveFomoEntries(real)).toEqual(real);
  });

  it("caps to MAX_FOMO_ENTRIES", () => {
    const real = Array.from({ length: 25 }, (_, i) => entry(i));
    expect(resolveFomoEntries(real)).toHaveLength(MAX_FOMO_ENTRIES);
  });

  it("never returns content that was not in the input (no fabrication)", () => {
    const real = [entry(7)];
    const out = resolveFomoEntries(real);
    expect(out.every((e) => real.includes(e))).toBe(true);
    // empty input must never yield a fabricated entry
    expect(resolveFomoEntries([]).length).toBe(0);
  });
});

/**
 * Staleness guard — 2026-09-17.
 *
 * Live, the ticker rendered "★★★★★ New 5-star review … 1987h ago": ~83 days
 * old, announced as new. Root cause was server-side (the review branch of
 * activity.recent filtered on rating with no date bound); this module is the
 * client-side backstop so no future branch can leak a stale row into a toast
 * that calls it current.
 */
describe("resolveFomoEntries — staleness", () => {
  it("drops an entry older than the max age", () => {
    const stale = aged(1987 * 60); // the exact age observed live
    expect(resolveFomoEntries([stale])).toEqual([]);
  });

  it("keeps an entry at the boundary and drops one past it", () => {
    expect(resolveFomoEntries([aged(MAX_ENTRY_AGE_MINUTES)])).toHaveLength(1);
    expect(resolveFomoEntries([aged(MAX_ENTRY_AGE_MINUTES + 1)])).toHaveLength(0);
  });

  it("keeps fresh entries while dropping stale ones in the same payload", () => {
    const out = resolveFomoEntries([aged(30), aged(1987 * 60), aged(120)]);
    expect(out.map((e) => e.minutesAgo)).toEqual([30, 120]);
  });

  it("drops entries with a non-numeric age rather than rendering them", () => {
    const bad = { type: "review", message: "x", minutesAgo: undefined } as unknown as FomoEntry;
    expect(resolveFomoEntries([bad])).toEqual([]);
  });

  it("canary: without the age bound the stale entry would survive", () => {
    // Proves the filter is what removes it, not the MAX_FOMO_ENTRIES slice.
    const stale = aged(1987 * 60);
    expect([stale].slice(0, MAX_FOMO_ENTRIES)).toHaveLength(1);
    expect(resolveFomoEntries([stale])).toHaveLength(0);
  });
});

describe("formatAgo", () => {
  it("rolls over to days instead of unbounded hours", () => {
    expect(formatAgo(1987 * 60)).toBe("83d ago");
  });

  it("formats minutes, hours and days at their boundaries", () => {
    expect(formatAgo(1)).toBe("1 min ago");
    expect(formatAgo(59)).toBe("59 min ago");
    expect(formatAgo(60)).toBe("1h ago");
    expect(formatAgo(23 * 60)).toBe("23h ago");
    expect(formatAgo(24 * 60)).toBe("1d ago");
    expect(formatAgo(3 * 24 * 60)).toBe("3d ago");
  });

  it("never renders a zero or negative age as '0 min ago'", () => {
    expect(formatAgo(0)).toBe("1 min ago");
    expect(formatAgo(-5)).toBe("1 min ago");
  });

  it("canary: the old hour-only formatter produced the live defect", () => {
    const old = (m: number) => (m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`);
    expect(old(1987 * 60)).toBe("1987h ago"); // what shipped
    expect(formatAgo(1987 * 60)).not.toBe("1987h ago");
  });
});
