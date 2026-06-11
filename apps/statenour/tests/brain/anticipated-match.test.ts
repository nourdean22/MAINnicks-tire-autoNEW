/**
 * findAnticipated + precomputeAnswers + buildAnticipatedContextBlock ·
 * the previously-unbuilt half of Arc B Feature 6 (2026-06-10).
 *
 * Pins:
 *   1. findAnticipated matches only at/above the 0.85 cosine floor
 *   2. questions WITHOUT a precomputed answer never match (even exact)
 *   3. the chat route's precomputed userEmbedding is reused (no
 *      message-embed call when provided)
 *   4. no stored set / no answers at all → null without embedding
 *   5. precomputeAnswers degrades per-question to null on failure/empty
 *   6. the context block carries the truth-rule framing and is "" on
 *      no-match (brain-context appends blindly)
 *
 * Kept separate from anticipated-questions.test.ts — that file's
 * module-scope aiChat mock returns a fixed "[]" which would collide
 * with precompute assertions here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findUnique: (args: unknown) => mockFindUnique(args),
    },
  },
}));

// Deterministic 2-d embedding space, keyed by exact text.
const embedMap = new Map<string, number[]>();
const mockGetEmbedding = vi.fn(async (text: string) => {
  const v = embedMap.get(text);
  if (!v) throw new Error(`no embedding stubbed for: ${text}`);
  return v;
});

vi.mock("@/lib/ai/provider", () => ({
  getEmbedding: (text: string) => mockGetEmbedding(text),
}));

const mockAiChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  // The source module calls makeTracedAiChat at module load — defer the
  // mockAiChat dereference to call time or it hits the const TDZ.
  makeTracedAiChat:
    () =>
    (...args: unknown[]) =>
      mockAiChat(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  },
}));

import {
  findAnticipated,
  buildAnticipatedContextBlock,
  precomputeAnswers,
  ANTICIPATED_MATCH_FLOOR,
  _resetTodayCacheForTests,
  _resetAnticipatedMatchCacheForTests,
  todayKey,
} from "@/lib/brain/anticipated-questions";

const Q1 = "How did the ALG declined work follow-up go?";
const Q2 = "What is the VAPI tuning status?";

function storedSet(answers: Array<string | null>) {
  return {
    metadata: {
      date: todayKey(),
      builtAt: "2026-06-10T07:05:00.000Z",
      questions: [
        { question: Q1, topic: "ALG", confidence: 0.8 },
        { question: Q2, topic: "VAPI", confidence: 0.7 },
      ],
      answers,
    },
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockGetEmbedding.mockClear();
  mockAiChat.mockReset();
  embedMap.clear();
  embedMap.set(Q1, [1, 0]);
  embedMap.set(Q2, [0, 1]);
  _resetTodayCacheForTests();
  _resetAnticipatedMatchCacheForTests();
});

describe("findAnticipated", () => {
  it("returns the matched question + cached answer at/above the cosine floor", async () => {
    mockFindUnique.mockResolvedValue(storedSet(["ALG take from last night", "VAPI take"]));
    const match = await findAnticipated("any message", [1, 0]);
    expect(match).not.toBeNull();
    expect(match?.question).toBe(Q1);
    expect(match?.topic).toBe("ALG");
    expect(match?.answer).toBe("ALG take from last night");
    expect(match?.similarity).toBeGreaterThanOrEqual(ANTICIPATED_MATCH_FLOOR);
    expect(match?.date).toBe(todayKey());
  });

  it("returns null below the 0.85 floor", async () => {
    mockFindUnique.mockResolvedValue(storedSet(["take 1", "take 2"]));
    // cos vs Q1 = 0.6 · cos vs Q2 = 0.8 — both under the floor.
    const match = await findAnticipated("any message", [0.6, 0.8]);
    expect(match).toBeNull();
  });

  it("never matches a question whose answer is null — even on an exact hit", async () => {
    mockFindUnique.mockResolvedValue(storedSet([null, "VAPI take"]));
    const match = await findAnticipated("any message", [1, 0]); // exact Q1
    expect(match).toBeNull();
  });

  it("reuses the provided user embedding — no message-embed call", async () => {
    mockFindUnique.mockResolvedValue(storedSet(["take 1", "take 2"]));
    await findAnticipated("the user message text", [1, 0]);
    // Only the two QUESTIONS get embedded (cached per day); the
    // message itself must not — the chat route already paid for it.
    const embedded = mockGetEmbedding.mock.calls.map((c) => c[0]);
    expect(embedded).not.toContain("the user message text");
  });

  it("embeds the message itself when no embedding is provided", async () => {
    mockFindUnique.mockResolvedValue(storedSet(["take 1", "take 2"]));
    embedMap.set("standalone caller message", [1, 0]);
    const match = await findAnticipated("standalone caller message");
    expect(match?.question).toBe(Q1);
  });

  it("returns null when no set is stored, and skips embedding entirely when no answers exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await findAnticipated("any message", [1, 0])).toBeNull();

    _resetTodayCacheForTests();
    mockFindUnique.mockResolvedValue(storedSet([null, null]));
    expect(await findAnticipated("any message", [1, 0])).toBeNull();
    // No-answers short-circuit fires before any embedding work.
    expect(mockGetEmbedding).not.toHaveBeenCalled();
  });
});

describe("loadTodaysSet yesterday-fallback (evening-build keying)", () => {
  // The anticipate cron runs in the mega-EVENING fan-out (~10-11pm ET,
  // before midnight), keying the row to the ENDING day. Without the
  // fallback every next-morning read silently got null — the feature
  // wrote rows nobody could read.
  it("falls back to yesterday's key when today's row is missing", async () => {
    mockFindUnique.mockImplementation((args: { where?: { category_key?: { key?: string } } }) => {
      const key = args?.where?.category_key?.key;
      if (key === `anticipated_${todayKey()}`) return Promise.resolve(null);
      return Promise.resolve(storedSet(["ALG take", null]));
    });
    const match = await findAnticipated("any message", [1, 0]);
    expect(match?.answer).toBe("ALG take");
    const keys = mockFindUnique.mock.calls.map(
      (c) => (c[0] as { where: { category_key: { key: string } } }).where.category_key.key,
    );
    expect(keys[0]).toBe(`anticipated_${todayKey()}`);
    expect(keys[1]).toMatch(/^anticipated_\d{4}-\d{2}-\d{2}$/);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("returns null when both today's and yesterday's rows are missing", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await findAnticipated("any message", [1, 0])).toBeNull();
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });
});

describe("precomputeAnswers", () => {
  it("returns a trimmed, capped answer per question", async () => {
    mockAiChat.mockResolvedValue({ content: "  A sharp take. " });
    const answers = await precomputeAnswers([
      { question: Q1, topic: "ALG" },
      { question: Q2, topic: "VAPI" },
    ]);
    expect(answers).toEqual(["A sharp take.", "A sharp take."]);
  });

  it("degrades per-question to null on failure or empty content", async () => {
    mockAiChat
      .mockResolvedValueOnce({ content: "good take" })
      .mockRejectedValueOnce(new Error("provider down"));
    const answers = await precomputeAnswers([
      { question: Q1, topic: "ALG" },
      { question: Q2, topic: "VAPI" },
    ]);
    expect(answers).toEqual(["good take", null]);

    mockAiChat.mockResolvedValue({ content: "   " });
    expect(await precomputeAnswers([{ question: Q1, topic: null }])).toEqual([null]);
  });

  it("returns [] for an empty question list without calling the model", async () => {
    expect(await precomputeAnswers([])).toEqual([]);
    expect(mockAiChat).not.toHaveBeenCalled();
  });

  it("caps stored answers at 1200 chars", async () => {
    mockAiChat.mockResolvedValue({ content: "x".repeat(5000) });
    const [answer] = await precomputeAnswers([{ question: Q1, topic: null }]);
    expect(answer?.length).toBe(1200);
  });
});

describe("buildAnticipatedContextBlock", () => {
  it("renders the match with the truth-rule framing", async () => {
    mockFindUnique.mockResolvedValue(storedSet(["The ALG take", "VAPI take"]));
    const block = await buildAnticipatedContextBlock("any message", [1, 0]);
    expect(block).toContain("ANTICIPATED QUESTION");
    expect(block).toContain(Q1);
    expect(block).toContain("[ALG]");
    expect(block).toContain("The ALG take");
    // Fabrication-defense framing must always ride along.
    expect(block).toContain("verify any live number");
    expect(block).toContain("never claim you already checked");
  });

  it("returns '' on no match (brain-context appends blindly)", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await buildAnticipatedContextBlock("any message", [1, 0])).toBe("");
  });

  it("returns '' instead of throwing when the lookup fails", async () => {
    mockFindUnique.mockRejectedValue(new Error("db down"));
    expect(await buildAnticipatedContextBlock("any message", [1, 0])).toBe("");
  });
});
