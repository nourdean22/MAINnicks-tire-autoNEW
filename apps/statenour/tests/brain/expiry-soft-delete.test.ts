/**
 * TTL expiry must SOFT-delete, not destroy.
 *
 * pruneNoise() hard-deleted every row whose `expiresAt` had passed. That is
 * where the distilled content went: of 4,867 memories found surviving only as
 * orphaned embeddings, the largest categories were `insight` (1,046),
 * `nick_advice` (648), `wisdom` (254) and `blind_spot` (249) — none of them
 * "temporary memories". A TTL landing on an insight destroyed it nightly, and
 * the only reason any of it was recoverable is that the sweep ALSO forgot to
 * delete the embedding, which kept a `content` copy by accident.
 *
 * Closing that accident (memory-tombstone) without changing this would have made
 * the loss permanent — hence this pin. Recall is unaffected either way: it
 * filters `deletedAt: null`, so the TTL still ends the memory's working life.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const updateMany = vi.fn(async () => ({ count: 3 }));
const deleteMany = vi.fn(async () => ({ count: 0 }));
const del = vi.fn(async () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      updateMany,
      deleteMany,
      delete: del,
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    vectorEmbedding: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  },
}));

describe("pruneNoise · TTL expiry", () => {
  beforeEach(() => {
    vi.resetModules();
    updateMany.mockClear();
    deleteMany.mockClear();
    del.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("soft-deletes expired rows instead of destroying them", async () => {
    const { pruneNoise } = await import("@/lib/brain/memory-consolidation");
    await pruneNoise();

    const expiryUpdate = updateMany.mock.calls.find((c) => {
      const arg = (c as unknown[])[0] as { where?: Record<string, unknown> };
      return arg?.where && "expiresAt" in arg.where;
    });
    expect(expiryUpdate, "expiry must go through updateMany (soft-delete)").toBeDefined();

    const arg = (expiryUpdate as unknown[])[0] as {
      data?: { deletedAt?: unknown };
    };
    expect(arg.data?.deletedAt, "soft-delete must stamp deletedAt").toBeInstanceOf(Date);
  });

  it("never routes expiry through a destructive delete", async () => {
    const { pruneNoise } = await import("@/lib/brain/memory-consolidation");
    await pruneNoise();

    for (const call of deleteMany.mock.calls) {
      const arg = (call as unknown[])[0] as { where?: Record<string, unknown> };
      expect(
        arg?.where && "expiresAt" in arg.where,
        "expiresAt must never appear in a deleteMany where-clause",
      ).toBeFalsy();
    }
  });
});
