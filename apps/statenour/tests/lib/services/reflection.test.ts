/**
 * Tests for lib/services/reflection.ts — the CoALA reflection layer
 * (task #12 · 2026-05-23).
 *
 * Coverage focus:
 *   1. insufficient-source short-circuit (count < minSourceCount)
 *   2. recent-reflection-exists short-circuit (24h dedup window)
 *   3. happy path · writes N insights via brainMemory.remember
 *   4. JSON parsing handles malformed LLM output (returns empty result)
 *   5. Hallucinated source ids are dropped (only valid cuids count)
 *
 * Pure unit · prisma + brainMemory + traced-aichat + extract-structured
 * are all mocked at the module boundary. NO real LLM calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted so vi.mock can see them) ─────────────────────────

const mocks = vi.hoisted(() => ({
  prismaBrainMemoryFindMany: vi.fn(),
  brainMemoryRemember: vi.fn(),
  aiChatFn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: mocks.prismaBrainMemoryFindMany,
    },
  },
}));

vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: {
    remember: mocks.brainMemoryRemember,
  },
}));

vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => mocks.aiChatFn,
}));

// Real extract-structured is fine · it's a pure parser. But keep a
// minimal mock so tests don't depend on its internals.
vi.mock("@/lib/ai/extract-structured", () => ({
  extractJsonObject: (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true, value: parsed };
      }
    } catch {
      /* fallthrough */
    }
    return { ok: false, error: "no_object" };
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }),
  },
}));

import { reflectOnCategory } from "@/lib/services/reflection";

// ── Helpers ─────────────────────────────────────────────────────────

/** Build a fake source-row from BrainMemory. */
function srcRow(id: string, content: string, confidence = 0.7) {
  return { id, content, confidence, seenCount: 1 };
}

/** Default `findMany` mock implementation · controllable per test. */
function setupFindMany(opts: {
  /** Source rows returned for the source-category query (first call). */
  source: Array<{ id: string; content: string; confidence: number; seenCount: number }>;
  /** Recent reflection rows for the dedup query (second call). */
  recentReflections?: Array<{ metadata: unknown }>;
}) {
  let call = 0;
  mocks.prismaBrainMemoryFindMany.mockImplementation(async () => {
    call += 1;
    if (call === 1) return opts.source;
    return opts.recentReflections ?? [];
  });
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default · remember returns a BrainMemory-shaped row with the same
  // id every call (sufficient for tests that don't inspect the row).
  mocks.brainMemoryRemember.mockImplementation(async (_cat, key) => ({
    id: `bm-${key}`,
    category: "reflection",
    key,
    content: "test",
  }));
});

describe("reflectOnCategory · insufficient-source", () => {
  it("skips when fewer than minSourceCount rows exist", async () => {
    setupFindMany({
      source: [srcRow("a", "one"), srcRow("b", "two")], // 2 < default 5
    });

    const result = await reflectOnCategory({ category: "decision_log" });

    expect(result.skipped).toBe("insufficient-source");
    expect(result.insightsWritten).toBe(0);
    expect(result.insights).toEqual([]);
    // No LLM call, no remember
    expect(mocks.aiChatFn).not.toHaveBeenCalled();
    expect(mocks.brainMemoryRemember).not.toHaveBeenCalled();
  });

  it("respects a custom minSourceCount", async () => {
    setupFindMany({ source: [srcRow("a", "one"), srcRow("b", "two")] });

    // 2 rows · minSourceCount=2 → should NOT skip
    setupFindMany({
      source: [srcRow("a", "one"), srcRow("b", "two")],
      recentReflections: [],
    });
    mocks.aiChatFn.mockResolvedValueOnce({
      provider: "venice",
      model: "test",
      content: JSON.stringify({
        insights: [
          {
            content: "Pattern across the two sources is X.",
            derivedFrom: ["a", "b"],
            confidence: 0.7,
          },
        ],
      }),
    });

    const result = await reflectOnCategory({
      category: "decision_log",
      minSourceCount: 2,
    });

    expect(result.skipped).toBeUndefined();
    expect(result.insightsWritten).toBe(1);
  });
});

describe("reflectOnCategory · recent-reflection-exists", () => {
  it("skips when a same-category reflection ran in the last 24h", async () => {
    setupFindMany({
      source: Array.from({ length: 6 }, (_, i) =>
        srcRow(`src-${i}`, `source content ${i}`),
      ),
      recentReflections: [
        { metadata: { sourceCategory: "decision_log", confidence: 0.7 } },
      ],
    });

    const result = await reflectOnCategory({ category: "decision_log" });

    expect(result.skipped).toBe("recent-reflection-exists");
    expect(result.insightsWritten).toBe(0);
    expect(mocks.aiChatFn).not.toHaveBeenCalled();
    expect(mocks.brainMemoryRemember).not.toHaveBeenCalled();
  });

  it("does NOT skip when the recent reflection is for a different category", async () => {
    setupFindMany({
      source: Array.from({ length: 6 }, (_, i) =>
        srcRow(`src-${i}`, `source content ${i}`),
      ),
      recentReflections: [
        { metadata: { sourceCategory: "pattern", confidence: 0.7 } },
      ],
    });
    mocks.aiChatFn.mockResolvedValueOnce({
      provider: "venice",
      model: "test",
      content: JSON.stringify({
        insights: [
          {
            content: "Cross-cutting insight here that spans multiple sources.",
            derivedFrom: ["src-0", "src-1"],
            confidence: 0.8,
          },
        ],
      }),
    });

    const result = await reflectOnCategory({ category: "decision_log" });

    expect(result.skipped).toBeUndefined();
    expect(result.insightsWritten).toBe(1);
  });
});

describe("reflectOnCategory · happy path", () => {
  it("writes N insights via brainMemory.remember with correct metadata", async () => {
    const sourceRows = Array.from({ length: 6 }, (_, i) =>
      srcRow(`src-${i}`, `source content ${i}`),
    );
    setupFindMany({ source: sourceRows, recentReflections: [] });

    mocks.aiChatFn.mockResolvedValueOnce({
      provider: "venice",
      model: "test",
      content: JSON.stringify({
        insights: [
          {
            content: "First synthesized insight spanning multiple sources.",
            derivedFrom: ["src-0", "src-1", "src-2"],
            confidence: 0.85,
          },
          {
            content: "Second insight on different axis.",
            derivedFrom: ["src-3", "src-4"],
            confidence: 0.7,
          },
        ],
      }),
    });

    const result = await reflectOnCategory({ category: "decision_log" });

    expect(result.skipped).toBeUndefined();
    expect(result.insightsWritten).toBe(2);
    expect(result.insights).toHaveLength(2);
    expect(result.insights[0].content).toBe(
      "First synthesized insight spanning multiple sources.",
    );
    expect(result.insights[0].derivedFrom).toEqual([
      "src-0",
      "src-1",
      "src-2",
    ]);
    expect(result.insights[0].confidence).toBe(0.85);

    // remember called once per insight with category=reflection
    expect(mocks.brainMemoryRemember).toHaveBeenCalledTimes(2);
    const firstCall = mocks.brainMemoryRemember.mock.calls[0];
    expect(firstCall[0]).toBe("reflection"); // category
    expect(firstCall[1]).toMatch(/^reflection:decision_log:/); // key shape
    expect(firstCall[3]).toBe("reflection"); // source
    // metadata
    const meta = firstCall[4] as Record<string, unknown>;
    expect(meta.sourceCategory).toBe("decision_log");
    expect(meta.derivedFrom).toEqual(["src-0", "src-1", "src-2"]);
    expect(meta.confidence).toBe(0.85);
    expect(meta.reflectionWindow).toBeDefined();
  });

  it("respects maxInsights cap", async () => {
    const sourceRows = Array.from({ length: 6 }, (_, i) =>
      srcRow(`src-${i}`, `source content ${i}`),
    );
    setupFindMany({ source: sourceRows, recentReflections: [] });

    // LLM returns 5, cap is 2
    mocks.aiChatFn.mockResolvedValueOnce({
      provider: "venice",
      model: "test",
      content: JSON.stringify({
        insights: Array.from({ length: 5 }, (_, i) => ({
          content: `Insight number ${i} spans sources here.`,
          derivedFrom: ["src-0", "src-1"],
          confidence: 0.7,
        })),
      }),
    });

    const result = await reflectOnCategory({
      category: "decision_log",
      maxInsights: 2,
    });

    expect(result.insightsWritten).toBe(2);
    expect(mocks.brainMemoryRemember).toHaveBeenCalledTimes(2);
  });
});

describe("reflectOnCategory · malformed LLM output", () => {
  it("returns empty result when LLM output is not parseable JSON", async () => {
    const sourceRows = Array.from({ length: 6 }, (_, i) =>
      srcRow(`src-${i}`, `source content ${i}`),
    );
    setupFindMany({ source: sourceRows, recentReflections: [] });

    mocks.aiChatFn.mockResolvedValueOnce({
      provider: "venice",
      model: "test",
      content: "sorry, I cannot do that as a JSON object",
    });

    const result = await reflectOnCategory({ category: "decision_log" });

    expect(result.insightsWritten).toBe(0);
    expect(result.insights).toEqual([]);
    expect(result.skipped).toBeUndefined(); // not skipped · just no output
    expect(mocks.brainMemoryRemember).not.toHaveBeenCalled();
  });

  it("returns empty result when insights array is missing", async () => {
    const sourceRows = Array.from({ length: 6 }, (_, i) =>
      srcRow(`src-${i}`, `source content ${i}`),
    );
    setupFindMany({ source: sourceRows, recentReflections: [] });

    mocks.aiChatFn.mockResolvedValueOnce({
      provider: "venice",
      model: "test",
      content: JSON.stringify({ wrong_key: [] }),
    });

    const result = await reflectOnCategory({ category: "decision_log" });

    expect(result.insightsWritten).toBe(0);
    expect(mocks.brainMemoryRemember).not.toHaveBeenCalled();
  });

  it("drops insights with hallucinated source ids", async () => {
    const sourceRows = Array.from({ length: 6 }, (_, i) =>
      srcRow(`src-${i}`, `source content ${i}`),
    );
    setupFindMany({ source: sourceRows, recentReflections: [] });

    mocks.aiChatFn.mockResolvedValueOnce({
      provider: "venice",
      model: "test",
      content: JSON.stringify({
        insights: [
          {
            content: "Insight A · cites a real source id.",
            derivedFrom: ["src-0"],
            confidence: 0.8,
          },
          {
            content: "Insight B · cites only hallucinated ids.",
            derivedFrom: ["bogus-1", "bogus-2"],
            confidence: 0.8,
          },
        ],
      }),
    });

    const result = await reflectOnCategory({ category: "decision_log" });

    // Only the first insight survives — second is dropped because all
    // of its derivedFrom ids are invalid.
    expect(result.insightsWritten).toBe(1);
    expect(result.insights[0].content).toBe(
      "Insight A · cites a real source id.",
    );
  });

  it("recovers from an LLM throw — returns empty result, no rows written", async () => {
    const sourceRows = Array.from({ length: 6 }, (_, i) =>
      srcRow(`src-${i}`, `source content ${i}`),
    );
    setupFindMany({ source: sourceRows, recentReflections: [] });

    mocks.aiChatFn.mockRejectedValueOnce(new Error("provider timeout"));

    const result = await reflectOnCategory({ category: "decision_log" });

    expect(result.insightsWritten).toBe(0);
    expect(result.insights).toEqual([]);
    expect(mocks.brainMemoryRemember).not.toHaveBeenCalled();
  });

  it("drops insights with content too short or too long", async () => {
    const sourceRows = Array.from({ length: 6 }, (_, i) =>
      srcRow(`src-${i}`, `source content ${i}`),
    );
    setupFindMany({ source: sourceRows, recentReflections: [] });

    mocks.aiChatFn.mockResolvedValueOnce({
      provider: "venice",
      model: "test",
      content: JSON.stringify({
        insights: [
          { content: "ok", derivedFrom: ["src-0"], confidence: 0.7 }, // too short
          {
            content: "a".repeat(1100), // too long
            derivedFrom: ["src-0"],
            confidence: 0.7,
          },
          {
            content: "Valid insight content spans sources.",
            derivedFrom: ["src-1"],
            confidence: 0.7,
          },
        ],
      }),
    });

    const result = await reflectOnCategory({ category: "decision_log" });

    expect(result.insightsWritten).toBe(1);
    expect(result.insights[0].content).toBe(
      "Valid insight content spans sources.",
    );
  });
});

describe("reflectOnCategory · confidence clamping", () => {
  it("clamps confidence outside 0..1", async () => {
    const sourceRows = Array.from({ length: 6 }, (_, i) =>
      srcRow(`src-${i}`, `source content ${i}`),
    );
    setupFindMany({ source: sourceRows, recentReflections: [] });

    mocks.aiChatFn.mockResolvedValueOnce({
      provider: "venice",
      model: "test",
      content: JSON.stringify({
        insights: [
          {
            content: "First with out-of-range confidence.",
            derivedFrom: ["src-0"],
            confidence: 1.5, // > 1
          },
          {
            content: "Second with negative confidence.",
            derivedFrom: ["src-1"],
            confidence: -0.2, // < 0
          },
        ],
      }),
    });

    const result = await reflectOnCategory({ category: "decision_log" });

    expect(result.insightsWritten).toBe(2);
    expect(result.insights[0].confidence).toBe(1);
    expect(result.insights[1].confidence).toBe(0);
  });
});
