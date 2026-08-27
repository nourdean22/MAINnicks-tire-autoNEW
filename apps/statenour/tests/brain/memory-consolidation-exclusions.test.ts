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
    // 2026-08-27 · the personal-memory eating: this engine soft-deleted 38
    // operator-curated pm_* rows (08-15..20, nightly) and rewrote 13 keepers,
    // including the operator-VERIFIED medication stack. Per-entity/per-event
    // record categories must never enter the merge pool.
    expect(notIn).toContain("identity");
    expect(notIn).toContain("biography");
    expect(notIn).toContain("relationships");
    expect(notIn).toContain("health");
    expect(notIn).toContain("event");
    expect(notIn).toContain("business_fact");
    expect(notIn).toContain("environment");
    expect(notIn).toContain("ai_directive");
    expect(notIn).toContain("vision");
    expect(notIn).toContain("fact");
  });

  it("never offers OPERATOR-CURATED rows to the merge LLM, in any category", async () => {
    // The orthogonal row-level guard. Categories like pattern/preference/goal
    // stay mergeable for machine rows, but rows the operator wrote
    // (createdBy "user") or imported as curated memory (source "manual") are
    // not the machine's to rewrite -- the 08-15..20 incident rewrote the
    // operator-verified medication stack into a fertility blob. This pins the
    // MECHANISM: the guard must reach BOTH queries (groupBy candidates and
    // the per-category findMany), as a null-safe Prisma NOT-array.
    mocks.brainMemory.groupBy.mockResolvedValue([
      { category: "pattern", _count: { id: 5 } },
    ]);
    mocks.brainMemory.findMany.mockResolvedValue([]); // <4 rows -> loop exits

    await mergeMemories();

    const guard = { NOT: [{ createdBy: "user" }, { source: "manual" }] };
    expect(mocks.brainMemory.groupBy.mock.calls[0][0].where).toMatchObject(guard);
    expect(mocks.brainMemory.findMany.mock.calls[0][0].where).toMatchObject({
      category: "pattern",
      deletedAt: null,
      ...guard,
    });
  });

  it("only considers categories with more than 3 live rows", async () => {
    await mergeMemories();
    expect(mocks.brainMemory.groupBy.mock.calls[0][0].having).toEqual({
      id: { _count: { gt: 3 } },
    });
  });
});
