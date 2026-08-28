/**
 * Canaries · filterJudgedBlindSpots (learning-loops wave 2026-08-28,
 * docs/LEARNING-LOOPS-2026-08-28.md gap 2).
 *
 * The live surfaces (getBlindSpots AI tool, Ultron) consulted NO verdict —
 * a spot the operator rated noise/known was still recited to him. These pin
 * the join: judged spots dropped and COUNTED, unjudged pass (positive
 * control), the explicit-null resurface is NOT suppressed (the mirror must
 * never outrank the source), and the filter fails OPEN.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { findMany: mocks.findMany } },
}));
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: vi.fn() },
}));

import {
  filterJudgedBlindSpots,
  blindSpotKey,
} from "@/lib/brain/blind-spot-identity";
import type { BlindSpot } from "@/lib/brain/blind-spot-detector";

const spot = (over: Partial<BlindSpot> = {}): BlindSpot =>
  ({
    domain: "commitments",
    severity: "high",
    description: "Commitment overdue: order winter tires",
    evidence: "3 days past due",
    daysSinceAttention: 3,
    suggestedAction: "Do it",
    ...over,
  }) as BlindSpot;

beforeEach(() => vi.clearAllMocks());

describe("filterJudgedBlindSpots", () => {
  it("BREAKS: a noise-judged spot is dropped and counted; unjudged passes (positive control)", async () => {
    const judged = spot();
    const fresh = spot({ description: "Lead untouched: Smith brake job" });
    // The fixture DUAL-WRITES like rateDiscovery does (column + metadata) —
    // a fake that omits a field certifies its own blind spot (08-22 lesson).
    mocks.findMany.mockResolvedValue([
      {
        key: blindSpotKey(judged),
        discoveryVerdict: "noise",
        metadata: { discoveryVerdict: "noise" },
      },
    ]);
    const { kept, suppressedJudged } = await filterJudgedBlindSpots([judged, fresh]);
    expect(kept.map((s) => s.description)).toEqual([fresh.description]);
    expect(suppressedJudged).toBe(1);
  });

  it("'known' suppresses too — that is the verdict's whole consumer", async () => {
    const s = spot();
    mocks.findMany.mockResolvedValue([
      { key: blindSpotKey(s), discoveryVerdict: "known", metadata: { discoveryVerdict: "known" } },
    ]);
    const r = await filterJudgedBlindSpots([s]);
    expect(r.kept).toEqual([]);
    expect(r.suppressedJudged).toBe(1);
  });

  it("'investigate' stays visible — the operator asked to work on it", async () => {
    const s = spot();
    mocks.findMany.mockResolvedValue([
      { key: blindSpotKey(s), discoveryVerdict: "investigate", metadata: { discoveryVerdict: "investigate" } },
    ]);
    expect((await filterJudgedBlindSpots([s])).kept).toEqual([s]);
  });

  it("BREAKS: an explicit metadata null (a resurface) overrides a stale noise column", async () => {
    const s = spot();
    mocks.findMany.mockResolvedValue([
      { key: blindSpotKey(s), discoveryVerdict: "noise", metadata: { discoveryVerdict: null } },
    ]);
    const r = await filterJudgedBlindSpots([s]);
    expect(r.kept).toEqual([s]);
    expect(r.suppressedJudged).toBe(0);
  });

  it("fails OPEN: a lookup error passes every spot through unfiltered", async () => {
    mocks.findMany.mockRejectedValue(new Error("neon down"));
    const spots = [spot(), spot({ description: "another" })];
    const r = await filterJudgedBlindSpots(spots);
    expect(r.kept).toEqual(spots);
    expect(r.suppressedJudged).toBe(0);
  });

  it("empty input costs zero queries", async () => {
    await filterJudgedBlindSpots([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
