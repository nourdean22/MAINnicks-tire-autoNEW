/**
 * tests/ai/board/mood-gating.test.ts · Wave L (2026-05-23).
 *
 * Pure-function coverage for the multi-advisor board's mood-gated
 * routing. The gating function is the structural heart of Wave L · a
 * regression here would silently change which advisors fire for major
 * operator decisions · we want that locked down.
 */

import { describe, it, expect } from "vitest";

import { gateMembersByMood, __testInternals } from "@/lib/ai/board/consult";
import { REGISTRY } from "@/lib/ai/strategic-frameworks";
import type { StrategicFramework } from "@/lib/ai/strategic-frameworks/types";

function frameworkById(id: string): StrategicFramework {
  const f = REGISTRY.find((x) => x.id === id);
  if (!f) throw new Error(`fixture: missing framework ${id}`);
  return f;
}

const FULL_BOARD: StrategicFramework[] = [
  frameworkById("elon-musk"),
  frameworkById("warren-buffett"),
  frameworkById("steve-jobs"),
  frameworkById("inversion"),
  frameworkById("pareto-principle"),
  frameworkById("porters-five-forces"),
];

describe("gateMembersByMood · MOOD_DROP_RULES", () => {
  it("returns the full member list unchanged when mood=neutral", () => {
    const { effective, droppedIds } = gateMembersByMood(FULL_BOARD, "neutral");
    expect(effective).toHaveLength(FULL_BOARD.length);
    expect(droppedIds).toEqual([]);
  });

  it("returns the full member list unchanged when mood=energized", () => {
    const { effective, droppedIds } = gateMembersByMood(FULL_BOARD, "energized");
    expect(effective).toHaveLength(FULL_BOARD.length);
    expect(droppedIds).toEqual([]);
  });

  it("drops push-harder advisors when mood=depleted", () => {
    const { effective, droppedIds } = gateMembersByMood(FULL_BOARD, "depleted");
    const keptIds = effective.map((m) => m.id);
    // elon-musk + steve-jobs are in the drop list AND are in FULL_BOARD
    // (growth-engine is in the drop list but NOT in FULL_BOARD · won't show in dropped[])
    expect(droppedIds.sort()).toEqual(["elon-musk", "steve-jobs"]);
    expect(keptIds).not.toContain("elon-musk");
    expect(keptIds).not.toContain("steve-jobs");
    // Buffett and inversion + pareto stay · they're well-suited for low-capacity
    expect(keptIds).toContain("warren-buffett");
    expect(keptIds).toContain("inversion");
  });

  it("drops complexity-adding advisors when mood=scattered", () => {
    const { effective, droppedIds } = gateMembersByMood(FULL_BOARD, "scattered");
    const keptIds = effective.map((m) => m.id);
    // porters-five-forces is in the drop list AND in FULL_BOARD
    expect(droppedIds).toContain("porters-five-forces");
    expect(keptIds).not.toContain("porters-five-forces");
    // pareto + inversion stay · those are good for scattered states
    expect(keptIds).toContain("pareto-principle");
    expect(keptIds).toContain("inversion");
  });

  it("safety-net · returns full members when gating would empty the board", () => {
    // Construct a board where EVERY member is in the depleted drop list.
    const dropAllBoard: StrategicFramework[] = [
      frameworkById("elon-musk"),
      frameworkById("steve-jobs"),
      frameworkById("growth-engine"),
    ];
    const { effective, droppedIds } = gateMembersByMood(dropAllBoard, "depleted");
    // Safety-net engaged · operator's curation wins · no drops.
    expect(effective).toHaveLength(3);
    expect(droppedIds).toEqual([]);
  });

  it("MOOD_DROP_RULES has zero overlap between energized/neutral and depleted/scattered", () => {
    // Sanity · neutral/energized should have no rules · depleted +
    // scattered should have non-empty rules.
    expect(__testInternals.MOOD_DROP_RULES.energized.size).toBe(0);
    expect(__testInternals.MOOD_DROP_RULES.neutral.size).toBe(0);
    expect(
      __testInternals.MOOD_DROP_RULES.depleted.size,
    ).toBeGreaterThan(0);
    expect(
      __testInternals.MOOD_DROP_RULES.scattered.size,
    ).toBeGreaterThan(0);
  });

  it("MOOD_DROP_RULES references real framework ids (no typos)", () => {
    // Every advisor in the drop rules must resolve in the framework
    // registry. Catches a typo like "elon-musks" or stale ids after
    // OSS rewires.
    const allDropIds = new Set<string>([
      ...__testInternals.MOOD_DROP_RULES.depleted,
      ...__testInternals.MOOD_DROP_RULES.scattered,
    ]);
    for (const id of allDropIds) {
      const f = REGISTRY.find((x) => x.id === id);
      expect(f, `framework "${id}" referenced in MOOD_DROP_RULES not found in REGISTRY`).toBeTruthy();
    }
  });
});
