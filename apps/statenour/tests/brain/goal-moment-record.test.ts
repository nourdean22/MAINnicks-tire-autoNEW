/**
 * goal_moment is a one-shot RECORD category (W6 second reader, 2026-11-03). Each row is keyed by one GoalEvent id
 * and never re-seen, so the 24 h probation would let pruneNoise soft-delete every goal moment a day after it was
 * written (the spaced_review 2026-10-17 and chat_summary 2026-10-30 incident). It must also stay out of the nightly
 * LLM merge (one row per GoalEvent) and out of decay and the low-confidence sweep.
 *
 * Arm 1 drives the REAL remember(); the dual arm (plain `goal`, the extractor's free-text facts, re-seeable) still
 * takes the probation, which proves the one-shot set is what is read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  aiChat: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: mocks.brainMemory, $queryRawUnsafe: vi.fn(async () => []), memoryEdge: { groupBy: vi.fn(async () => []) } },
}));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeMemoryEmbedding: vi.fn(async () => undefined), getEmbedding: vi.fn(async () => []) }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => mocks.aiChat }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import { brainMemory } from "@/lib/brain/memory-manager";
import { mergeMemories, pruneNoise } from "@/lib/brain/memory-consolidation";
import { buildDecayWhere } from "@/lib/brain/memory-decay";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { CONTEXT_CATEGORIES } from "@/lib/brain/memory-recall";

const DAY = 86_400_000;
const created = (category: string) =>
  mocks.brainMemory.create.mock.calls.map((c) => c[0].data as Record<string, unknown>).find((d) => d.category === category);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.findUnique.mockResolvedValue(null);
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.brainMemory.count.mockResolvedValue(0);
  mocks.brainMemory.updateMany.mockResolvedValue({ count: 0 });
  mocks.brainMemory.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "mem_new", ...data }));
});

describe("goal_moment through the real remember()", () => {
  it("a goal moment gets no expiry (no probation, no TTL)", async () => {
    await brainMemory.remember(BRAIN_CATEGORIES.GOAL_MOMENT, "goal_event:ge_1", 'Achieved "Save $15k"', "goal-moment", { goalId: "g1" });
    const row = created("goal_moment");
    expect(row, "the goal_moment row was created").toBeTruthy();
    expect(row!.expiresAt).toBeNull();
  });

  it("DUAL: a free-text goal fact still takes the 24 h probation", async () => {
    const before = Date.now();
    await brainMemory.remember(BRAIN_CATEGORIES.GOAL, "save_15k", "Nour wants to save $15k this quarter", "knowledge-extraction");
    const row = created("goal");
    expect(row!.expiresAt).toBeInstanceOf(Date);
    const ms = (row!.expiresAt as Date).getTime() - before;
    expect(ms).toBeGreaterThan(DAY - 60_000);
    expect(ms).toBeLessThan(DAY + 60_000);
  });

  it("goal_moment rides chat recall", () => {
    expect(CONTEXT_CATEGORIES.has(BRAIN_CATEGORIES.GOAL_MOMENT)).toBe(true);
  });
});

describe("goal_moment survives consolidation", () => {
  it("the merge never sees goal moments: two near-identical moments both survive", async () => {
    const rows = [
      { id: "m1", key: "goal_event:ge_1", content: 'Check-in on "Lift" (on_track): no note', confidence: 0.5, seenCount: 1, metadata: {} },
      { id: "m2", key: "goal_event:ge_2", content: 'Check-in on "Lift" (on_track): no note', confidence: 0.5, seenCount: 1, metadata: {} },
    ];
    // groupBy honours the notIn list, as the database would.
    mocks.brainMemory.groupBy.mockImplementation(async ({ where }: { where: { category: { notIn: string[] } } }) =>
      where.category.notIn.includes("goal_moment") ? [] : [{ category: "goal_moment", _count: { id: 6 } }],
    );
    mocks.brainMemory.findMany.mockResolvedValue([...rows, ...rows.map((r) => ({ ...r, id: `${r.id}b` })), ...rows.map((r) => ({ ...r, id: `${r.id}c` }))]);
    mocks.aiChat.mockResolvedValue({ provider: "test", content: '[{"keep":0,"merge":[1,2,3,4,5],"merged_content":"Lift check-ins"}]' });
    await mergeMemories();
    expect(mocks.brainMemory.findMany).not.toHaveBeenCalled();
    expect(mocks.brainMemory.updateMany).not.toHaveBeenCalled();
  });

  it("decay exempts goal moments", async () => {
    const { params } = await buildDecayWhere();
    expect(params[1]).toContain("goal_moment");
  });

  it("both pruneNoise sweeps (expired, low confidence) skip goal moments", async () => {
    await pruneNoise();
    const sweeps = mocks.brainMemory.updateMany.mock.calls
      .map((c) => c[0].where)
      .filter((w) => w?.deletedAt === null && (w.expiresAt || w.confidence));
    expect(sweeps.length).toBe(2);
    for (const w of sweeps) expect(w.category.notIn).toContain("goal_moment");
  });
});
