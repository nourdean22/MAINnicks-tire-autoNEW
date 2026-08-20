/**
 * Consolidation exclusions (2026-08-19 · outcome-loop wave).
 *
 * mergeMemories LLM-rewrites a category's rows into one prose keeper and
 * soft-deletes the rest. Two classes of category must never enter it:
 * structured JSON payloads (the 2026-07-12 incident class) and provenance
 * records — reasoning_trace (the $1/day budget sums non-deleted rows, so a
 * merge makes the engine overspend), reasoning_conclusion (per-run, TTL'd),
 * and task_lesson (the operator's verbatim words, keyed per task).
 *
 * This pins the MECHANISM — the exclusion list reaching the groupBy query —
 * not just the constant's contents.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { groupBy: vi.fn(), findMany: vi.fn() },
  aiChat: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: mocks.brainMemory } }));
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => mocks.aiChat,
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import { mergeMemories } from "@/lib/brain/memory-consolidation";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.groupBy.mockResolvedValue([]);
});

describe("mergeMemories · category exclusions", () => {
  it("never offers provenance or structured-payload categories to the merge LLM", async () => {
    await mergeMemories();

    const notIn: string[] =
      mocks.brainMemory.groupBy.mock.calls[0][0].where.category.notIn;

    // Provenance class (2026-08-19): budget integrity + verbatim records.
    expect(notIn).toContain("reasoning_trace");
    expect(notIn).toContain("reasoning_conclusion");
    expect(notIn).toContain("task_lesson");
    // Memory-loop wave: the grinder finding (158 soft-deleted summaries)
    // + self-audit (the odometer row is the same class).
    expect(notIn).toContain("conversation_summary");
    expect(notIn).toContain("decision_log");
    expect(notIn).toContain("insight");
    expect(notIn).toContain("eval_run");
    // Structured-payload class (2026-07-12 incident): spot-check survivors.
    expect(notIn).toContain("ai_config");
    expect(notIn).toContain("morning_brief_audio");
  });

  it("only considers categories with more than 3 live rows", async () => {
    await mergeMemories();
    expect(mocks.brainMemory.groupBy.mock.calls[0][0].having).toEqual({
      id: { _count: { gt: 3 } },
    });
  });
});
