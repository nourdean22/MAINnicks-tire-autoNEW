/**
 * Unit tests for resolveFomoEntries — guards the FomoTicker honesty rule:
 * it shows ONLY real server activity and NEVER fabricates. This test exists
 * so the old hardcoded fake bookings/reviews can't sneak back in.
 */
import { describe, it, expect } from "vitest";
import { resolveFomoEntries, MAX_FOMO_ENTRIES, type FomoEntry } from "../components/fomoEntries";

const entry = (i: number): FomoEntry => ({ type: "completed", message: `real job ${i}`, minutesAgo: i });

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
