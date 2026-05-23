/**
 * Tests for lib/services/reflection-read.ts — the read-side projection
 * for the /brain/reflections viewer (task #13 · 2026-05-23).
 *
 * Coverage focus:
 *   1. metadata projection · sourceCategory / derivedFrom /
 *      reflectionWindow / confidence pluck from BrainMemory.metadata Json
 *   2. defensive coercion · malformed window / non-string derivedFrom /
 *      out-of-range confidence / missing sourceCategory all coerce
 *      cleanly without throwing
 *   3. sourceCategory filter · the post-query JS filter behaves
 *      identically whether the cron-iterated categories or a custom one
 *      is asked for · "all" / undefined reset the filter
 *   4. limit clamp · 1..100 ceiling honored
 *   5. ordering · createdAt desc preserved
 *
 * Pure unit · prisma is mocked at the module boundary. NO real DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted so vi.mock can see them) ─────────────────────────

const mocks = vi.hoisted(() => ({
  prismaBrainMemoryFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: mocks.prismaBrainMemoryFindMany,
    },
  },
}));

import { listRecentReflections } from "@/lib/services/reflection-read";

// ── Helpers ─────────────────────────────────────────────────────────

interface FakeRow {
  id: string;
  content: string;
  metadata: unknown;
  createdAt: Date;
}

function makeRow(
  id: string,
  content: string,
  metadata: unknown,
  daysAgo = 0,
): FakeRow {
  return {
    id,
    content,
    metadata,
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  };
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listRecentReflections · metadata projection", () => {
  it("projects sourceCategory / derivedFrom / reflectionWindow / confidence to top-level scalars", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("r1", "First synthesized insight.", {
        sourceCategory: "decision_log",
        derivedFrom: ["src-1", "src-2", "src-3"],
        reflectionWindow: {
          from: "2026-05-16T00:00:00.000Z",
          to: "2026-05-23T00:00:00.000Z",
          days: 7,
        },
        confidence: 0.85,
      }),
    ]);

    const result = await listRecentReflections();
    expect(result.reflections).toHaveLength(1);
    const r = result.reflections[0];
    expect(r.id).toBe("r1");
    expect(r.content).toBe("First synthesized insight.");
    expect(r.sourceCategory).toBe("decision_log");
    expect(r.derivedFrom).toEqual(["src-1", "src-2", "src-3"]);
    expect(r.reflectionWindow).toEqual({
      from: "2026-05-16T00:00:00.000Z",
      to: "2026-05-23T00:00:00.000Z",
      days: 7,
    });
    expect(r.confidence).toBe(0.85);
    expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO string
  });

  it("preserves multiple rows in createdAt-desc order from the DB query", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow(
        "newest",
        "Latest insight.",
        {
          sourceCategory: "pattern",
          derivedFrom: ["a"],
          reflectionWindow: { from: "x", to: "y", days: 7 },
          confidence: 0.7,
        },
        0,
      ),
      makeRow(
        "older",
        "Older insight.",
        {
          sourceCategory: "pattern",
          derivedFrom: ["b"],
          reflectionWindow: { from: "x", to: "y", days: 7 },
          confidence: 0.6,
        },
        2,
      ),
    ]);

    const result = await listRecentReflections();
    expect(result.reflections.map((r) => r.id)).toEqual(["newest", "older"]);
  });

  it("passes the createdAt-desc orderBy + category filter to prisma", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([]);
    await listRecentReflections();
    expect(mocks.prismaBrainMemoryFindMany).toHaveBeenCalledTimes(1);
    const args = mocks.prismaBrainMemoryFindMany.mock.calls[0][0];
    expect(args.where.category).toBe("reflection");
    expect(args.where.deletedAt).toBeNull();
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });
});

describe("listRecentReflections · defensive coercion", () => {
  it("coerces a malformed reflectionWindow to null", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("bad-window", "Insight with broken window.", {
        sourceCategory: "pattern",
        derivedFrom: ["src-1"],
        reflectionWindow: "not an object",
        confidence: 0.7,
      }),
    ]);
    const result = await listRecentReflections();
    expect(result.reflections[0].reflectionWindow).toBeNull();
  });

  it("coerces missing window fields to null", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("partial-window", "Insight with partial window.", {
        sourceCategory: "pattern",
        derivedFrom: ["src-1"],
        // Missing 'days' field · entire window should coerce to null.
        reflectionWindow: { from: "x", to: "y" },
        confidence: 0.7,
      }),
    ]);
    const result = await listRecentReflections();
    expect(result.reflections[0].reflectionWindow).toBeNull();
  });

  it("filters non-string entries out of derivedFrom", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("mixed-deriveds", "Insight with mixed-type derivedFrom.", {
        sourceCategory: "pattern",
        derivedFrom: ["good-1", 42, null, "good-2", { obj: 1 }],
        reflectionWindow: null,
        confidence: 0.7,
      }),
    ]);
    const result = await listRecentReflections();
    expect(result.reflections[0].derivedFrom).toEqual(["good-1", "good-2"]);
  });

  it("coerces non-array derivedFrom to empty array", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("no-derived", "Insight with object derivedFrom.", {
        sourceCategory: "pattern",
        derivedFrom: { not: "an array" },
        reflectionWindow: null,
        confidence: 0.7,
      }),
    ]);
    const result = await listRecentReflections();
    expect(result.reflections[0].derivedFrom).toEqual([]);
  });

  it("clamps confidence above 1 down to 1", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("hot-conf", "Out-of-range confidence.", {
        sourceCategory: "pattern",
        derivedFrom: ["src-1"],
        reflectionWindow: null,
        confidence: 1.7,
      }),
    ]);
    const result = await listRecentReflections();
    expect(result.reflections[0].confidence).toBe(1);
  });

  it("clamps negative confidence up to 0", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("neg-conf", "Negative confidence.", {
        sourceCategory: "pattern",
        derivedFrom: ["src-1"],
        reflectionWindow: null,
        confidence: -0.4,
      }),
    ]);
    const result = await listRecentReflections();
    expect(result.reflections[0].confidence).toBe(0);
  });

  it("coerces non-number confidence to null", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("no-conf", "String confidence.", {
        sourceCategory: "pattern",
        derivedFrom: ["src-1"],
        reflectionWindow: null,
        confidence: "high",
      }),
    ]);
    const result = await listRecentReflections();
    expect(result.reflections[0].confidence).toBeNull();
  });

  it("falls back to 'unknown' when sourceCategory is missing", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("no-cat", "Missing sourceCategory.", {
        derivedFrom: ["src-1"],
        reflectionWindow: null,
        confidence: 0.5,
      }),
    ]);
    const result = await listRecentReflections();
    expect(result.reflections[0].sourceCategory).toBe("unknown");
  });

  it("falls back to 'unknown' when sourceCategory is empty string", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("empty-cat", "Empty sourceCategory.", {
        sourceCategory: "",
        derivedFrom: ["src-1"],
        reflectionWindow: null,
        confidence: 0.5,
      }),
    ]);
    const result = await listRecentReflections();
    expect(result.reflections[0].sourceCategory).toBe("unknown");
  });

  it("handles null metadata without throwing", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      {
        id: "null-meta",
        content: "Insight with null metadata.",
        metadata: null,
        createdAt: new Date(),
      },
    ]);
    const result = await listRecentReflections();
    expect(result.reflections).toHaveLength(1);
    expect(result.reflections[0].sourceCategory).toBe("unknown");
    expect(result.reflections[0].derivedFrom).toEqual([]);
    expect(result.reflections[0].reflectionWindow).toBeNull();
    expect(result.reflections[0].confidence).toBeNull();
  });
});

describe("listRecentReflections · sourceCategory filter", () => {
  it("filters to only rows matching the requested sourceCategory", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("d1", "Decision insight.", {
        sourceCategory: "decision_log",
        derivedFrom: ["a"],
        reflectionWindow: null,
        confidence: 0.7,
      }),
      makeRow("p1", "Pattern insight.", {
        sourceCategory: "pattern",
        derivedFrom: ["b"],
        reflectionWindow: null,
        confidence: 0.7,
      }),
      makeRow("d2", "Another decision insight.", {
        sourceCategory: "decision_log",
        derivedFrom: ["c"],
        reflectionWindow: null,
        confidence: 0.7,
      }),
    ]);
    const result = await listRecentReflections({
      sourceCategory: "decision_log",
    });
    expect(result.reflections.map((r) => r.id)).toEqual(["d1", "d2"]);
  });

  it("does NOT filter when sourceCategory is 'all'", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("d1", "Decision insight.", {
        sourceCategory: "decision_log",
        derivedFrom: ["a"],
        reflectionWindow: null,
        confidence: 0.7,
      }),
      makeRow("p1", "Pattern insight.", {
        sourceCategory: "pattern",
        derivedFrom: ["b"],
        reflectionWindow: null,
        confidence: 0.7,
      }),
    ]);
    const result = await listRecentReflections({ sourceCategory: "all" });
    expect(result.reflections).toHaveLength(2);
  });

  it("does NOT filter when sourceCategory is undefined", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("d1", "Decision insight.", {
        sourceCategory: "decision_log",
        derivedFrom: ["a"],
        reflectionWindow: null,
        confidence: 0.7,
      }),
      makeRow("p1", "Pattern insight.", {
        sourceCategory: "pattern",
        derivedFrom: ["b"],
        reflectionWindow: null,
        confidence: 0.7,
      }),
    ]);
    const result = await listRecentReflections();
    expect(result.reflections).toHaveLength(2);
  });

  it("over-pulls from DB when filtering, to make room for the post-filter", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([]);
    await listRecentReflections({
      sourceCategory: "decision_log",
      limit: 50,
    });
    const args = mocks.prismaBrainMemoryFindMany.mock.calls[0][0];
    // limit=50 + filtering → take should exceed 50 (we ask for headroom)
    expect(args.take).toBeGreaterThan(50);
    expect(args.take).toBeLessThanOrEqual(200);
  });

  it("uses the bare limit as `take` when not filtering", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([]);
    await listRecentReflections({ limit: 25 });
    const args = mocks.prismaBrainMemoryFindMany.mock.calls[0][0];
    expect(args.take).toBe(25);
  });
});

describe("listRecentReflections · limit clamp", () => {
  it("respects the requested limit when results exceed it", async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow(`r${i}`, `Insight ${i}.`, {
        sourceCategory: "pattern",
        derivedFrom: [`src-${i}`],
        reflectionWindow: null,
        confidence: 0.7,
      }),
    );
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce(rows);
    const result = await listRecentReflections({ limit: 3 });
    expect(result.reflections).toHaveLength(3);
  });

  it("clamps limit above 100 down to 100", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([]);
    await listRecentReflections({ limit: 500 });
    const args = mocks.prismaBrainMemoryFindMany.mock.calls[0][0];
    expect(args.take).toBeLessThanOrEqual(100);
  });

  it("clamps limit below 1 up to 1", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([]);
    await listRecentReflections({ limit: 0 });
    const args = mocks.prismaBrainMemoryFindMany.mock.calls[0][0];
    expect(args.take).toBeGreaterThanOrEqual(1);
  });

  it("defaults to limit=50 when not provided", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([]);
    await listRecentReflections();
    const args = mocks.prismaBrainMemoryFindMany.mock.calls[0][0];
    expect(args.take).toBe(50);
  });
});

describe("listRecentReflections · empty cases", () => {
  it("returns an empty array when prisma returns no rows", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([]);
    const result = await listRecentReflections();
    expect(result.reflections).toEqual([]);
  });

  it("returns an empty array when filter matches nothing", async () => {
    mocks.prismaBrainMemoryFindMany.mockResolvedValueOnce([
      makeRow("p1", "Pattern insight.", {
        sourceCategory: "pattern",
        derivedFrom: ["a"],
        reflectionWindow: null,
        confidence: 0.7,
      }),
    ]);
    const result = await listRecentReflections({
      sourceCategory: "decision_log",
    });
    expect(result.reflections).toEqual([]);
  });
});
