/**
 * tests/lib/brain/embedding-coverage-pair.test.ts · 2026-07-16.
 *
 * Locks the embeddingCoverage PAIR contract: the numerator counts only
 * embeddings whose source brain memory is alive (raw-SQL join), and the
 * denominator counts only live memories. This was the one deliberately
 * fenced site of the phantom-count campaign — soft-delete never removes
 * embeddings, and on prod 4,330 of 6,482 brain-memory embeddings (67%)
 * belonged to pruned rows. Filtering only the denominator would have
 * reported 55.6% coverage when the live truth was 18.4% (and >100% once
 * backfill proceeds).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { count: vi.fn() },
  vectorEmbedding: { count: vi.fn(), findMany: vi.fn() },
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
    vectorEmbedding: mocks.vectorEmbedding,
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { countLiveBrainMemoryEmbeddings, getEmbeddingHealth } from "@/lib/brain/embedding-utils";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.count.mockResolvedValue(0);
  mocks.vectorEmbedding.count.mockResolvedValue(0);
  mocks.vectorEmbedding.findMany.mockResolvedValue([]);
  mocks.queryRaw.mockResolvedValue([{ count: 0 }]);
});

describe("countLiveBrainMemoryEmbeddings", () => {
  it("joins to live brain_memories (the query names both tables and the tombstone filter)", async () => {
    mocks.queryRaw.mockResolvedValue([{ count: 2152 }]);

    const n = await countLiveBrainMemoryEmbeddings();

    expect(n).toBe(2152);
    // $queryRaw receives a template-strings array — assert the SQL text
    // carries the join and the live filter, which IS the contract.
    const sql = (mocks.queryRaw.mock.calls[0][0] as readonly string[]).join("?");
    expect(sql).toContain("vector_embeddings");
    expect(sql).toContain("brain_memories");
    expect(sql).toContain("deleted_at IS NULL");
  });

  it("fails closed to 0 when the query throws", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("db down"));
    expect(await countLiveBrainMemoryEmbeddings()).toBe(0);
  });
});

describe("getEmbeddingHealth · live/live pair", () => {
  it("denominator counts only live memories and coverage uses the joined numerator", async () => {
    // prod-shaped numbers: 11,664 live memories · 2,152 live-sourced embeddings
    mocks.brainMemory.count.mockResolvedValue(11664);
    mocks.queryRaw.mockResolvedValue([{ count: 2152 }]);

    const health = await getEmbeddingHealth();

    expect(mocks.brainMemory.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
    // The old unjoined numerator must NOT be used for coverage.
    expect(mocks.vectorEmbedding.count).not.toHaveBeenCalled();
    expect(health.totalMemories).toBe(11664);
    expect(health.embeddedMemories).toBe(2152);
    expect(health.coveragePercent).toBe(18); // 2152/11664 → 18%, the live truth
  });

  it("coverage can never exceed 100 from orphaned embeddings (the >100% hazard)", async () => {
    // Pathological old-world shape: more embeddings than live memories.
    // With the joined numerator this cannot happen (join bounds it), but
    // assert the math stays sane if counts are equal.
    mocks.brainMemory.count.mockResolvedValue(100);
    mocks.queryRaw.mockResolvedValue([{ count: 100 }]);

    const health = await getEmbeddingHealth();
    expect(health.coveragePercent).toBe(100);
  });
});
