/**
 * v10.0.526 · Arc B Feature 6 · anticipated-question regression armor.
 *
 * Locks in the contracts the cron + chat-route inject path depend on:
 *   1. gatherSignals composes the 4-lane structure correctly
 *   2. draftAnticipatedQuestions caps at 3, dedups topics, length-bounds
 *   3. findAnticipated only matches above the 0.85 cosine floor
 *   4. Empty 7d window is a clean cold-start (no signals → no draft call)
 *   5. precomputeAnswers degrades to null when LLM/pipeline unavailable
 *
 * Pure-function focus where possible · DB calls are mocked at the
 * prisma boundary (same pattern as reflection-idempotency.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { findMany: vi.fn() },
    masteryDecision: { findMany: vi.fn() },
    commitment: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    brainMemory: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  getEmbedding: vi.fn(),
}));

vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () =>
    vi.fn(async () => ({
      provider: "venice",
      model: "test",
      content: "[]",
    })),
}));

vi.mock("@/lib/ai/extract-structured", () => ({
  extractJsonArray: (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { ok: true, value: parsed };
    } catch {
      /* fallthrough */
    }
    // Bare-array-in-text fallback used by the live extractor.
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        if (Array.isArray(parsed)) return { ok: true, value: parsed };
      } catch {
        /* fallthrough */
      }
    }
    return { ok: false, error: "no_array" };
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
    }),
  },
}));

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import {
  gatherSignals,
  draftAnticipatedQuestions,
  precomputeAnswers,
  findAnticipated,
  ANTICIPATED_MATCH_FLOOR,
  _resetTodayCacheForTests,
  type GatheredSignals,
} from "@/lib/brain/anticipated-questions";

// ── Test helpers ────────────────────────────────────────────────────

function mockEmbed(vec: number[]): void {
  vi.mocked(getEmbedding).mockImplementation(async () => vec);
}

/**
 * Build a unit vector that scores ~target cosine against a fixed
 * reference vector [1,0,0,...]. We seed the orthogonal component on
 * axis 1 so cosine = target exactly when the rest is zero.
 */
function vecAtCosine(target: number, dim = 32): number[] {
  const v = new Array(dim).fill(0);
  v[0] = target;
  v[1] = Math.sqrt(Math.max(0, 1 - target * target));
  return v;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetTodayCacheForTests();
});

// ── 1. gatherSignals ────────────────────────────────────────────────

describe("gatherSignals · 4-lane signal collection", () => {
  it("returns total=0 cleanly when every lane is empty (cold start)", async () => {
    vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.masteryDecision.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.commitment.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any);

    const signals = await gatherSignals(7);
    expect(signals.total).toBe(0);
    expect(signals.chats).toEqual([]);
    expect(signals.decisions).toEqual([]);
    expect(signals.commitments).toEqual([]);
    expect(signals.openLoops).toEqual([]);
  });

  it("normalizes each lane to the Signal shape with kind discriminator", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([
      { content: "what's the declined work backlog?", createdAt: now },
    ] as any);
    vi.mocked(prisma.masteryDecision.findMany).mockResolvedValue([
      {
        title: "Switch image-gen back to Venice",
        chosen: "Venice flux-2-pro",
        context: "OpenAI billing-cap was hitting on dev",
        date: "2026-05-08",
      },
    ] as any);
    vi.mocked(prisma.commitment.findMany).mockResolvedValue([
      {
        description: "Action 367 declined estimates",
        deadline: "2026-05-20",
        status: "active",
        dateMade: "2026-05-07",
      },
    ] as any);
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      {
        title: "Wire bulk-SMS recovery UI",
        nextPhysicalAction: "Test multi-select on declined-work table",
        createdAt: now,
      },
    ] as any);

    const signals = await gatherSignals(7);
    expect(signals.total).toBe(4);
    expect(signals.chats[0]).toMatchObject({
      kind: "chat",
      text: "what's the declined work backlog?",
    });
    expect(signals.decisions[0]?.kind).toBe("decision");
    expect(signals.decisions[0]?.text).toContain("Venice flux-2-pro");
    expect(signals.commitments[0]?.kind).toBe("commitment");
    expect(signals.commitments[0]?.text).toContain("[active]");
    expect(signals.openLoops[0]?.kind).toBe("open_loop");
    expect(signals.openLoops[0]?.text).toContain("→");
  });

  it("survives one lane throwing without dropping the others", async () => {
    const now = new Date();
    vi.mocked(prisma.chatMessage.findMany).mockRejectedValue(new Error("db down"));
    vi.mocked(prisma.masteryDecision.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.commitment.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { title: "Test", nextPhysicalAction: null, createdAt: now },
    ] as any);

    const signals = await gatherSignals(7);
    expect(signals.chats).toEqual([]);
    expect(signals.openLoops).toHaveLength(1);
    expect(signals.total).toBe(1);
  });
});

// ── 2. draftAnticipatedQuestions ────────────────────────────────────

describe("draftAnticipatedQuestions · shape + dedup contract", () => {
  it("returns [] immediately on cold-start signals (skips draft call)", async () => {
    const empty: GatheredSignals = {
      chats: [],
      decisions: [],
      commitments: [],
      openLoops: [],
      total: 0,
    };
    const out = await draftAnticipatedQuestions(empty);
    expect(out).toEqual([]);
  });

  it("dedups by topic (case-insensitive) and caps at 3", async () => {
    // Re-mock with a content that has 4 questions, 2 sharing a topic.
    // vi.resetModules + vi.doMock together force the lib to re-import
    // with the new aiChat factory output.
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({ prisma: {} }));
    vi.doMock("@/lib/ai/provider", () => ({ getEmbedding: vi.fn() }));
    vi.doMock("@/lib/logger", () => ({
      logger: { withSurface: () => ({ info: () => {}, warn: () => {}, error: () => {} }) },
    }));
    vi.doMock("@/lib/ai/extract-structured", () => ({
      extractJsonArray: (raw: string) => {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return { ok: true, value: parsed };
        } catch { /* fallthrough */ }
        return { ok: false, error: "no_array" };
      },
    }));
    vi.doMock("@/lib/ai/traced-aichat", () => ({
      makeTracedAiChat: () =>
        async () => ({
          provider: "venice",
          model: "test",
          content: JSON.stringify([
            { question: "How is ALG today?", topic: "ALG" },
            { question: "ALG declined work follow-ups?", topic: "alg" }, // dup topic
            { question: "VAPI latency p50?", topic: "VAPI" },
            { question: "Brain feedback loop active?", topic: "brain" },
          ]),
        }),
    }));

    const fresh = await import("@/lib/brain/anticipated-questions");
    const out = await fresh.draftAnticipatedQuestions({
      chats: [
        { kind: "chat", text: "alg again", createdAt: new Date().toISOString() },
      ],
      decisions: [],
      commitments: [],
      openLoops: [],
      total: 1,
    });

    expect(out).toHaveLength(3);
    const topics = out.map((q) => (q.topic ?? "").toLowerCase());
    expect(new Set(topics).size).toBe(3); // no dups
    for (const q of out) expect(q.question.length).toBeLessThan(200);
  });

  it("returns [] when the LLM response is unparseable garbage", async () => {
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({ prisma: {} }));
    vi.doMock("@/lib/ai/provider", () => ({ getEmbedding: vi.fn() }));
    vi.doMock("@/lib/logger", () => ({
      logger: { withSurface: () => ({ info: () => {}, warn: () => {}, error: () => {} }) },
    }));
    vi.doMock("@/lib/ai/extract-structured", () => ({
      extractJsonArray: (raw: string) => {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return { ok: true, value: parsed };
        } catch { /* fallthrough */ }
        return { ok: false, error: "no_array" };
      },
    }));
    vi.doMock("@/lib/ai/traced-aichat", () => ({
      makeTracedAiChat: () =>
        async () => ({
          provider: "venice",
          model: "test",
          content: "I apologize but I can't predict the future",
        }),
    }));
    const fresh = await import("@/lib/brain/anticipated-questions");
    const out = await fresh.draftAnticipatedQuestions({
      chats: [{ kind: "chat", text: "x", createdAt: new Date().toISOString() }],
      decisions: [],
      commitments: [],
      openLoops: [],
      total: 1,
    });
    expect(out).toEqual([]);
  });
});

// ── 3. precomputeAnswers ────────────────────────────────────────────

describe("precomputeAnswers · timeout + fallback contract", () => {
  it("returns null per question when the runner throws (provider down)", async () => {
    const answers = await precomputeAnswers(
      [{ question: "Q1", topic: null }, { question: "Q2", topic: null }],
      {
        perQuestionTimeoutMs: 1000,
        runnerOverride: async () => {
          throw new Error("provider unavailable");
        },
      },
    );
    expect(answers).toEqual([null, null]);
  });

  it("returns precomputed strings when the runner resolves", async () => {
    const answers = await precomputeAnswers(
      [
        { question: "Q1", topic: null },
        { question: "Q2", topic: "t" },
      ],
      {
        perQuestionTimeoutMs: 1000,
        runnerOverride: async (q) => `answer for: ${q.question}`,
      },
    );
    expect(answers).toEqual(["answer for: Q1", "answer for: Q2"]);
  });

  it("times out per-question and yields null without blocking others", async () => {
    const answers = await precomputeAnswers(
      [
        { question: "slow", topic: null },
        { question: "fast", topic: null },
      ],
      {
        perQuestionTimeoutMs: 50,
        runnerOverride: async (q) => {
          if (q.question === "slow") {
            await new Promise((r) => setTimeout(r, 500));
            return "should-not-reach";
          }
          return "fast-answer";
        },
      },
    );
    expect(answers[0]).toBeNull(); // timed out
    expect(answers[1]).toBe("fast-answer");
  });
});

// ── 4. findAnticipated · cosine floor + freshness ───────────────────

describe("findAnticipated · cosine match at ask-time", () => {
  function buildStoredSet(builtAt: Date, questionsCount = 2) {
    return {
      date: new Date().toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
      }),
      builtAt: builtAt.toISOString(),
      questions: Array.from({ length: questionsCount }, (_, i) => ({
        question: `Question ${i + 1}`,
        topic: `topic-${i + 1}`,
      })),
      answers: Array.from(
        { length: questionsCount },
        (_, i) => `precomputed answer ${i + 1}`,
      ),
    };
  }

  it("returns null when no set is stored", async () => {
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValue(null);
    const match = await findAnticipated("anything?");
    expect(match).toBeNull();
  });

  it("returns null when cosine is below the 0.85 floor", async () => {
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValue({
      metadata: buildStoredSet(new Date()),
      updatedAt: new Date(),
    } as any);

    // Reference vec on every getEmbedding call · query gets [target,...]
    // questions get the reference [1,0,...]. cosine = target.
    let call = 0;
    vi.mocked(getEmbedding).mockImplementation(async () => {
      call++;
      // first call = query, then per-question. Score query at 0.5.
      return call === 1 ? vecAtCosine(0.5) : [1, 0, ...new Array(30).fill(0)];
    });

    const match = await findAnticipated("anything that doesn't match");
    expect(match).toBeNull();
  });

  it("returns the highest-similarity match above the floor", async () => {
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValue({
      metadata: buildStoredSet(new Date(), 2),
      updatedAt: new Date(),
    } as any);

    // Query scores 0.92 vs Q1 (the ref) and 0.0 vs Q2 (orthogonal)
    const queryVec = [1, 0, ...new Array(30).fill(0)];
    const q1Vec = vecAtCosine(0.92); // [0.92, 0.39, ...]
    const q2Vec = [0, 1, ...new Array(30).fill(0)]; // orthogonal to query

    let call = 0;
    vi.mocked(getEmbedding).mockImplementation(async () => {
      call++;
      if (call === 1) return queryVec;
      if (call === 2) return q1Vec;
      return q2Vec;
    });

    const match = await findAnticipated("very similar to question 1");
    expect(match).not.toBeNull();
    expect(match?.question).toBe("Question 1");
    expect(match?.answer).toBe("precomputed answer 1");
    expect(match?.similarity).toBeGreaterThan(ANTICIPATED_MATCH_FLOOR);
    expect(match?.fresh).toBe(true);
  });

  it("blocks stale sets (>24h) unless allowStale=true", async () => {
    const stale = new Date(Date.now() - 36 * 60 * 60 * 1000);
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValue({
      metadata: buildStoredSet(stale, 1),
      updatedAt: stale,
    } as any);
    mockEmbed([1, 0, ...new Array(30).fill(0)]);

    const blocked = await findAnticipated("Question 1");
    expect(blocked).toBeNull();

    _resetTodayCacheForTests();
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValue({
      metadata: buildStoredSet(stale, 1),
      updatedAt: stale,
    } as any);

    const allowed = await findAnticipated("Question 1", { allowStale: true });
    expect(allowed).not.toBeNull();
    expect(allowed?.fresh).toBe(false);
  });

  it("skips slots where the precompute is null", async () => {
    const set = buildStoredSet(new Date(), 2);
    set.answers[0] = null as unknown as string; // simulate failed precompute
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValue({
      metadata: set,
      updatedAt: new Date(),
    } as any);

    const queryVec = [1, 0, ...new Array(30).fill(0)];
    const q1Vec = vecAtCosine(0.95); // would win, but answer is null
    const q2Vec = vecAtCosine(0.9); // below q1 but has an answer

    let call = 0;
    vi.mocked(getEmbedding).mockImplementation(async () => {
      call++;
      if (call === 1) return queryVec;
      if (call === 2) return q1Vec;
      return q2Vec;
    });

    const match = await findAnticipated("question");
    expect(match).not.toBeNull();
    // Q1 was higher cosine but had null answer · we get Q2 instead
    expect(match?.question).toBe("Question 2");
  });
});
