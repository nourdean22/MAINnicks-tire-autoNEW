/**
 * persistReasoningConclusion (2026-08-19 · outcome-loop wave).
 *
 * "Nick reasons hard, then forgets what he concluded" — the raw
 * reasoning_trace row is bookkeeping (budget sums daily spend from it,
 * recall deliberately excludes it, it has no embedding). This pins the
 * recallable companion: one distilled reasoning_conclusion row per run,
 * embedded, TTL'd 90d, never throwing into the engine.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { create: vi.fn() },
  storeMemoryEmbedding: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: mocks.brainMemory } }));
vi.mock("@/lib/brain/embedding-utils", () => ({
  storeMemoryEmbedding: mocks.storeMemoryEmbedding,
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import {
  composeConclusionContent,
  persistReasoningConclusion,
} from "@/lib/ai/reasoning/persist-conclusion";

const input = {
  question: "Should we raise tire prices before winter?",
  answer: "Yes — hold labor, raise tires 4%, competitors already moved.",
  confidence: 0.72,
  tier: "deep",
  traceKey: "reasoning_deep_123_abc",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.create.mockResolvedValue({ id: "bm-c1" });
  mocks.storeMemoryEmbedding.mockResolvedValue(undefined);
});

describe("composeConclusionContent", () => {
  it("distills question → conclusion, whitespace-collapsed, recall-sized", () => {
    const content = composeConclusionContent({
      ...input,
      question: "Should   we\n raise tire prices?",
    });
    expect(content).toBe(
      "Reasoned (deep): Should we raise tire prices? → concluded: Yes — hold labor, raise tires 4%, competitors already moved.",
    );
  });

  it("caps both halves so a mega run cannot flood recall", () => {
    const content = composeConclusionContent({
      ...input,
      question: "q".repeat(1000),
      answer: "a".repeat(5000),
    });
    expect(content.length).toBeLessThan(800);
  });
});

describe("persistReasoningConclusion", () => {
  it("writes the reasoning_conclusion row with a 90d expiresAt and embeds it", async () => {
    await persistReasoningConclusion(input);

    const create = mocks.brainMemory.create.mock.calls[0][0];
    expect(create.data.category).toBe("reasoning_conclusion");
    expect(create.data.key).toBe("reasoning_conclusion:reasoning_deep_123_abc");
    expect(create.data.confidence).toBe(0.72);
    // TTL: ~90 days out (sweeper deletes expired rows; the raw trace has
    // its own 500-row rotation independently).
    const ttlMs = create.data.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(89 * 86_400_000);
    expect(ttlMs).toBeLessThan(91 * 86_400_000);
    // Without a vector the row is invisible to recall — the embed is the point.
    expect(mocks.storeMemoryEmbedding).toHaveBeenCalledWith(
      "bm-c1",
      composeConclusionContent(input),
    );
  });

  it("clamps a wild confidence into [0,1]", async () => {
    await persistReasoningConclusion({ ...input, confidence: 7 });
    expect(mocks.brainMemory.create.mock.calls[0][0].data.confidence).toBe(1);
  });

  it("skips empty runs — no row for an empty answer", async () => {
    await persistReasoningConclusion({ ...input, answer: "  " });
    expect(mocks.brainMemory.create).not.toHaveBeenCalled();
  });

  it("never throws into the engine — create failure resolves silently", async () => {
    mocks.brainMemory.create.mockRejectedValue(new Error("db down"));
    await expect(persistReasoningConclusion(input)).resolves.toBeUndefined();
  });

  it("an embed failure does not unwind the created row", async () => {
    mocks.storeMemoryEmbedding.mockRejectedValue(new Error("provider down"));
    await expect(persistReasoningConclusion(input)).resolves.toBeUndefined();
    expect(mocks.brainMemory.create).toHaveBeenCalledTimes(1);
  });
});
