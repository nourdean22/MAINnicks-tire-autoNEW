/**
 * findAnticipated + precomputeAnswers + buildAnticipatedContextBlock ·
 * the previously-unbuilt half of Arc B Feature 6 (2026-06-10).
 *
 * Pins:
 *   1. findAnticipated matches only at/above the ANTICIPATED_MATCH_FLOOR
 *      cosine floor (0.72 since 2026-08-06 — recalibrated from 0.85 against
 *      measured prod data; assert the CONSTANT, never a literal)
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

// 2026-08-06 · info is a spy now, not a no-op — the match_probe telemetry is
// the only thing that distinguishes "scored and missed" from "no set today",
// and that distinction is what let an unreachable floor hide for four months.
const mockLogInfo = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({ info: (...a: unknown[]) => mockLogInfo(...a), warn: () => {}, error: () => {} }),
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
  mockLogInfo.mockReset();
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

  it("returns null below the match floor", async () => {
    mockFindUnique.mockResolvedValue(storedSet(["take 1", "take 2"]));
    // 2026-08-06 · this case used 2-D vectors [0.6, 0.8] against the old 0.85
    // floor. Two problems once the floor moved to 0.72 (see
    // ANTICIPATED_MATCH_FLOOR — lowered against measured prod data):
    //   1. 0.8 vs Q2 now CLEARS the floor, so the case stopped testing a miss.
    //   2. Geometry: with orthogonal 2-D question vectors [1,0] and [0,1], the
    //      best of the two cosines is minimised at 45deg and can never go below
    //      0.707. A 2-D fixture therefore cannot sit safely under a 0.72 floor
    //      at all — it would have had ~0.013 of headroom at best.
    // Third dimension fixes both: the message sits mostly along an axis
    // NEITHER question occupies, so it is genuinely unlike both.
    embedMap.set(Q1, [1, 0, 0]);
    embedMap.set(Q2, [0, 1, 0]);
    // |v| = sqrt(1+1+4) = 2.449 -> cos vs Q1 = cos vs Q2 = 1/2.449 = 0.408.
    const match = await findAnticipated("any message", [1, 1, 2]);
    expect(match).toBeNull();
  });

  // 2026-08-06 · THE REGRESSION GUARD for the floor recalibration.
  //
  // In prod this block fired 0 times in 1,040 turns because the floor sat at
  // 0.85 — a bar that measured data says is unreachable (nearest-neighbour
  // similarity across 250 real chat vectors: median 0.615, p90 0.773). This
  // test pins the newly-admitted band: a score that clears 0.72 but would
  // have missed 0.85. Revert the constant to 0.85 and this goes red, which is
  // the whole point — the old value must not creep back in silently.
  it("matches in the 0.72-0.85 band that the old floor excluded", async () => {
    mockFindUnique.mockResolvedValue(storedSet(["ALG take", "VAPI take"]));
    // cos vs Q1 = 0.8 — above the calibrated floor, below the old one.
    const match = await findAnticipated("any message", [0.8, 0.6]);
    expect(ANTICIPATED_MATCH_FLOOR).toBeLessThanOrEqual(0.8);
    expect(ANTICIPATED_MATCH_FLOOR).toBeLessThan(0.85);
    expect(match).not.toBeNull();
    expect(match?.question).toBe(Q1);
    expect(match?.similarity).toBeCloseTo(0.8, 2);
  });

  it("logs the observed best similarity even when the turn MISSES", async () => {
    mockFindUnique.mockResolvedValue(storedSet(["take 1", "take 2"]));
    embedMap.set(Q1, [1, 0, 0]);
    embedMap.set(Q2, [0, 1, 0]);
    const match = await findAnticipated("any message", [1, 1, 2]);
    expect(match).toBeNull();

    // A miss must still be observable. Without this the logs cannot tell
    // "floor too high" (bestSim just under it) from "predictions are wrong"
    // (bestSim near zero) — two different repairs.
    const probe = mockLogInfo.mock.calls.find((c) => c[0] === "anticipated.match_probe");
    expect(probe, "match_probe was not emitted on a miss").toBeTruthy();
    expect(probe?.[1]).toMatchObject({ hit: false, floor: ANTICIPATED_MATCH_FLOOR, candidates: 2 });
    expect(probe?.[1].bestSim).toBeCloseTo(0.408, 2);
    expect(probe?.[1].nearestQuestion).toBe(Q1);
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
    // Pin the EXACT yesterday key (NY timezone) — a UTC or off-by-one
    // regression in yesterdayKey() must fail here, not just produce
    // "some other date".
    const expectedYesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    expect(keys[1]).toBe(`anticipated_${expectedYesterday}`);
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

  it("rejects the provider-failure sentinel — aiChat RETURNS it instead of throwing", async () => {
    // lib/ai/provider.ts returns { content: "I'm having trouble
    // connecting…", provider: "emergency" } on total chain failure;
    // without the provider check this would be stored as the answer
    // and injected into next-day chat as a "draft take".
    mockAiChat.mockResolvedValue({
      content:
        "I'm having trouble connecting to my AI providers right now. Try again in a moment, or switch to a different mode.",
      provider: "emergency",
      model: "none",
    });
    expect(await precomputeAnswers([{ question: Q1, topic: null }])).toEqual([null]);

    mockAiChat.mockResolvedValue({ content: "real take", provider: "none", model: "none" });
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
