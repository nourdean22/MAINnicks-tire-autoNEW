/**
 * A critic finding is "costly" only when the posts carrying it are skipped
 * more by a margin relabelling would rarely produce (2026-10-08).
 */
import { describe, expect, it } from "vitest";
import { MIN_PER_SIDE, measureFindingCosts, type QaOutcomeRow } from "./renderedQaOutcomes";

const row = (postId: string, codes: string[], skipRate: number | null): QaOutcomeRow => ({ postId, codes, skipRate });

describe("measureFindingCosts", () => {
  it("a code whose posts are skipped far more is costly, with the numbers that say so", () => {
    const rows = [
      ...[88, 91, 86, 90, 89].map((s, i) => row(`p${i}`, ["PLASTIC_AI_LOOK"], s)),
      ...[52, 48, 55, 50, 47, 53].map((s, i) => row(`c${i}`, [], s)),
    ];
    const [plastic] = measureFindingCosts(rows);
    expect(plastic.code).toBe("PLASTIC_AI_LOOK");
    expect(plastic.costly).toBe(true);
    expect(plastic.withN).toBe(5);
    expect(plastic.withoutN).toBe(6);
    expect(plastic.deltaPoints).toBeCloseTo(88.8 - 50.83, 1);
    expect(plastic.p).toBeLessThanOrEqual(plastic.alpha);
  });

  it("a gap noise could explain is reported but not costly", () => {
    const rows = [
      ...[62, 58, 70, 55].map((s, i) => row(`p${i}`, ["WEAK_COMPOSITION"], s)),
      ...[60, 57, 66, 54, 63].map((s, i) => row(`c${i}`, [], s)),
    ];
    const [weak] = measureFindingCosts(rows);
    expect(weak.costly).toBe(false);
    expect(weak.p).toBeGreaterThan(weak.alpha);
  });

  it("a code whose posts are skipped LESS is never costly, however significant", () => {
    const rows = [
      ...[20, 22, 18, 21].map((s, i) => row(`p${i}`, ["LIGHTING_DRIFT"], s)),
      ...[70, 72, 68, 71, 69].map((s, i) => row(`c${i}`, [], s)),
    ];
    const [r] = measureFindingCosts(rows);
    expect(r.deltaPoints).toBeLessThan(0);
    expect(r.costly).toBe(false);
  });

  it(`fewer than ${MIN_PER_SIDE} posts on either side is not tested, and unreported skip rates do not count`, () => {
    const thin = [
      ...[95, 96, 97].map((s, i) => row(`p${i}`, ["GENERIC_STOCK_LOOK"], s)),
      row("p3", ["GENERIC_STOCK_LOOK"], null),
      ...[40, 41, 42, 43].map((s, i) => row(`c${i}`, [], s)),
    ];
    expect(measureFindingCosts(thin)).toEqual([]);
  });

  it("the threshold is divided by the number of codes tested (Bonferroni)", () => {
    const rows = [
      ...[88, 91, 86, 90].map((s, i) => row(`a${i}`, ["A"], s)),
      ...[70, 73, 69, 72].map((s, i) => row(`b${i}`, ["B"], s)),
      ...[52, 48, 55, 50].map((s, i) => row(`c${i}`, [], s)),
    ];
    const costs = measureFindingCosts(rows);
    expect(costs).toHaveLength(2);
    for (const c of costs) expect(c.alpha).toBeCloseTo(0.025, 6);
  });
});
