/**
 * v10.0.526 · Arc B Feature 6 · anticipated-question regression armor.
 *
 * Locks in the contracts the cron pipeline depends on:
 *   1. gatherSignals composes the 4-lane structure correctly
 *   2. draftAnticipatedQuestions caps at 3, dedups topics, length-bounds
 *   3. Empty 7d window is a clean cold-start (no signals → no draft call)
 *
 * findAnticipated / precomputeAnswers / the chat-route inject block are
 * pinned in tests/brain/anticipated-match.test.ts (separate file — this
 * file's module-scope aiChat mock returns a fixed "[]" which would
 * collide with precompute assertions).
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
import {
  gatherSignals,
  draftAnticipatedQuestions,
  _resetTodayCacheForTests,
  type GatheredSignals,
} from "@/lib/brain/anticipated-questions";

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
