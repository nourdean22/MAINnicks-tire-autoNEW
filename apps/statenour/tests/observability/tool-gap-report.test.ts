import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  turns: vi.fn(),
  gates: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    toolSelectionTurn: { findMany: (...a: unknown[]) => mocks.turns(...a) },
    toolGateDecision: { findMany: (...a: unknown[]) => mocks.gates(...a) },
  },
}));

import { buildToolGapReport } from "@/lib/observability/tool-gap-report";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gates.mockResolvedValue([]);
});

describe("buildToolGapReport", () => {
  it("classifies a recovered budgeted-out tool as routing, not a missing capability", async () => {
    mocks.turns.mockResolvedValue([
      {
        turnId: "t1",
        budgetTruncated: true,
        semanticTierAttempted: true,
        embeddingCacheWarm: true,
        searchToolsFired: true,
        invokeToolFired: true,
        invokedToolName: "getHabitStreaks",
      },
    ]);
    mocks.gates.mockResolvedValue([
      { turnId: "t1", toolName: "getHabitStreaks", verdict: "BUDGETED_OUT" },
    ]);

    const report = await buildToolGapReport(30);

    expect(report.available).toBe(true);
    expect(report.recoverySearches).toBe(1);
    expect(report.recoveredExistingTools).toBe(1);
    expect(report.topGaps).toEqual([
      expect.objectContaining({
        classification: "ROUTING_GAP",
        toolName: "getHabitStreaks",
        count: 1,
      }),
    ]);
  });

  it("keeps search-without-recovery explicitly unresolved", async () => {
    mocks.turns.mockResolvedValue([
      {
        turnId: "t2",
        budgetTruncated: false,
        semanticTierAttempted: false,
        embeddingCacheWarm: false,
        searchToolsFired: true,
        invokeToolFired: false,
        invokedToolName: null,
      },
    ]);

    const report = await buildToolGapReport(30);

    expect(report.unresolvedSearches).toBe(1);
    expect(report.topGaps[0]).toMatchObject({
      classification: "UNRESOLVED_GAP",
      toolName: null,
    });
  });
  it("never turns a missing telemetry table into a confident zero", async () => {
    const err = Object.assign(new Error("missing table"), { code: "P2021" });
    mocks.turns.mockRejectedValueOnce(err);

    const report = await buildToolGapReport(30);

    expect(report.available).toBe(false);
    expect(report.caveat).toContain("unavailable");
  });

  it("measures cold-cache rate only over turns that attempted the semantic tier", async () => {
    mocks.turns.mockResolvedValue([
      {
        turnId: "a",
        budgetTruncated: false,
        semanticTierAttempted: true,
        embeddingCacheWarm: false,
        searchToolsFired: false,
        invokeToolFired: false,
        invokedToolName: null,
      },
      {
        turnId: "b",
        budgetTruncated: false,
        semanticTierAttempted: false,
        embeddingCacheWarm: false,
        searchToolsFired: false,
        invokeToolFired: false,
        invokedToolName: null,
      },
    ]);

    const report = await buildToolGapReport(30);

    expect(report.coldCacheRatePct).toBe(100);
    expect(report.semanticSkippedRatePct).toBe(50);
  });
});
