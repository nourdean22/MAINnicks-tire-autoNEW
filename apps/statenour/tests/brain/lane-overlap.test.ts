/**
 * tests/brain/lane-overlap.test.ts · 2026-09-08 (Brain plan, Wave 0)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeLaneOverlap } from "@/lib/brain/lane-overlap";

describe("computeLaneOverlap", () => {
  it("counts ids the contextual lane returned that the hybrid lane already carried", () => {
    expect(computeLaneOverlap(["a", "b", "c", "d"], ["c", "d", "e"])).toEqual({ contextual: 4, hybrid: 3, shared: 2, ratio: 0.5 });
  });
  it("is duplicate-safe and empty-safe (no division by zero, no NaN)", () => {
    expect(computeLaneOverlap(["a", "a"], ["a"])).toEqual({ contextual: 1, hybrid: 1, shared: 1, ratio: 1 });
    expect(computeLaneOverlap([], ["a"])).toEqual({ contextual: 0, hybrid: 1, shared: 0, ratio: 0 });
  });
  it("is wired: brain-context observes the contextual ranking and logs the overlap beside the hybrid hits", () => {
    const src = readFileSync(join(process.cwd(), "lib/services/chat/brain-context.ts"), "utf8");
    expect(src).toMatch(/onRanked: \(rows/);
    expect(src).toMatch(/computeLaneOverlap\(/);
    expect(src).toMatch(/recall_lane_overlap/);
    expect(src).toMatch(/laneOverlap,\n\s*detectedContradictions/);
  });
});
