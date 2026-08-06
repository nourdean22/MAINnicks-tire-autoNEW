/**
 * 2026-08-06 · surfaceContradictions recall + gate observability.
 *
 * WHY THIS FILE EXISTS
 *
 * The contradiction detector produced 0 rows in the 3.5 months to 2026-08-06,
 * and nothing in the code could tell you why — every gate rejects silently.
 * The obvious suspect was the >=0.78 similarity threshold. Measurement
 * refuted that (39.0% of prod brain memories have a neighbour at or above
 * 0.78; median nearest is 0.711), so the threshold was annotated, not tuned.
 *
 * Two real defects were fixed instead, and this file pins both:
 *
 *   1. RECALL · semanticSearch was asked for the top 8 neighbours out of the
 *      whole 8,553-row brain_memory corpus, and the category filter that
 *      narrows to the ~10 eligible rows ran AFTERWARDS. Eligible rows are
 *      ~0.1% of the corpus, so a real contradiction pair could exist and
 *      never enter the window. K raised to 200.
 *
 *   2. OBSERVABILITY · a gate_probe log now fires on every scored call, hit
 *      or miss, carrying the per-gate survivor counts. Without it "the pool
 *      is starved" and "detectSignal is too narrow" look identical from
 *      outside — they need different repairs.
 *
 * Both tests assert the MECHANISM. Reverting either fix turns one red.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSemanticSearch = vi.fn();
vi.mock("@/lib/brain/embedding-utils", () => ({
  semanticSearch: (...a: unknown[]) => mockSemanticSearch(...a),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    auditEvent: { create: vi.fn() },
  },
}));

const mockLogInfo = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: (...a: unknown[]) => mockLogInfo(...a),
      warn: () => {},
      error: () => {},
    }),
  },
}));

vi.mock("@/lib/utils/error-log", () => ({ logError: () => {} }));

import { prisma } from "@/lib/prisma";
import { surfaceContradictions } from "@/lib/brain/contradiction-surfacer";

const FRESH_ID = "mem-fresh";

/** A chat_importance row in the shape importance-scorer actually writes. */
function importanceRow(id: string, excerpt: string, daysAgo: number) {
  return {
    id,
    category: "chat_importance",
    content: JSON.stringify({ excerpt, primary: "decision" }),
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  };
}

beforeEach(() => {
  vi.mocked(prisma.brainMemory.findUnique).mockReset();
  vi.mocked(prisma.brainMemory.findMany).mockReset();
  vi.mocked(prisma.brainMemory.upsert).mockReset();
  mockSemanticSearch.mockReset();
  mockLogInfo.mockReset();
  vi.mocked(prisma.brainMemory.upsert).mockResolvedValue({ id: "x" } as never);
});

describe("surfaceContradictions · neighbour recall", () => {
  it("asks for enough neighbours that the ~0.1% eligible slice can survive the category filter", async () => {
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValue(
      importanceRow(FRESH_ID, "Hiring the second technician is the right call", 0) as never,
    );
    mockSemanticSearch.mockResolvedValue([]);

    await surfaceContradictions(FRESH_ID);

    expect(mockSemanticSearch).toHaveBeenCalledTimes(1);
    const [, limit, sourceTypes] = mockSemanticSearch.mock.calls[0];

    // The specific defect: a top-8 draw from an 8,553-row corpus, filtered to
    // eligible categories only afterwards. 8 is not "a bit low" here, it is
    // structurally unable to reach the eligible slice. Revert to 8 and this
    // goes red.
    expect(limit).toBeGreaterThanOrEqual(100);
    expect(sourceTypes).toEqual(["brain_memory"]);
  });
});

describe("surfaceContradictions · gate observability", () => {
  it("reports per-gate survivor counts when the run finds nothing", async () => {
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValue(
      importanceRow(FRESH_ID, "Hiring the second technician is the right call", 0) as never,
    );

    // Two neighbours clear 0.78. One is INELIGIBLE by category (the shape that
    // starves this detector in prod today); the other is eligible but too
    // recent to clear the 7-day gate.
    mockSemanticSearch.mockResolvedValue([
      { sourceId: "mem-ineligible", similarity: 0.91, content: "x" },
      { sourceId: "mem-too-recent", similarity: 0.83, content: "y" },
    ]);
    vi.mocked(prisma.brainMemory.findMany).mockResolvedValue([
      {
        id: "mem-ineligible",
        category: "journal_brain_take", // not in ELIGIBLE_CATEGORIES
        content: JSON.stringify({ excerpt: "unrelated" }),
        createdAt: new Date(Date.now() - 90 * 86_400_000),
      },
      importanceRow("mem-too-recent", "I'm not hiring anyone else this year", 2),
    ] as never);

    const out = await surfaceContradictions(FRESH_ID);
    expect(out).toEqual([]);

    const probe = mockLogInfo.mock.calls.find((c) => c[0] === "contradiction.gate_probe");
    expect(probe, "gate_probe was not emitted on a miss").toBeTruthy();

    // The counts must localise the failure, not just report one. Both
    // neighbours cleared 0.78, exactly one cleared the category gate, and
    // none cleared the age gate — so this run says "input eligibility",
    // not "detectSignal too narrow".
    expect(probe?.[1]).toMatchObject({
      candidates: 2,
      eligibleCategory: 1,
      agedApart: 0,
      signal: 0,
      conflicts: 0,
    });
    expect(vi.mocked(prisma.brainMemory.upsert)).not.toHaveBeenCalled();
  });
});
