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

  // Scout 4 round 3 (2026-10-17): a spaced_review row is a review schedule, not a probationary
  // observation. A stray expiresAt on one (any writer) must not soft-delete it; the TTL sweep
  // still prunes every other category (the positive control).
  it("an expired-looking spaced_review row survives the sweep; an expired insight is still pruned", async () => {
    const past = new Date(Date.now() - 3_600_000);
    const rows = [
      { id: "sr", category: "spaced_review", expiresAt: past, deletedAt: null as Date | null, confidence: 0.05, lastSeen: new Date(0) },
      { id: "in", category: "insight", expiresAt: past, deletedAt: null as Date | null, confidence: 0.5, lastSeen: new Date() },
    ];
    // Evaluates the operators pruneNoise's where clauses use, against the rows above.
    const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
      Object.entries(where).every(([field, cond]): boolean => {
        // 2026-10-29 · the curated guard: NOT [...] passes only when no listed clause matches.
        if (field === "NOT") return !(cond as Record<string, unknown>[]).some((c) => matches(row, c));
        const v = row[field];
        if (cond === null || cond instanceof Date || typeof cond !== "object") return v === cond;
        const c = cond as Record<string, unknown>;
        const unknownOp = Object.keys(c).find((k) => !["lt", "not", "notIn", "in", "startsWith"].includes(k));
        if (unknownOp) throw new Error(`evaluator does not model "${unknownOp}" on ${field}`);
        if ("lt" in c && !(v != null && (v as number) < (c.lt as number))) return false;
        if ("not" in c && v === c.not) return false;
        if ("notIn" in c && (c.notIn as unknown[]).includes(v)) return false;
        if ("in" in c && !(c.in as unknown[]).includes(v)) return false;
        if ("startsWith" in c && !(typeof v === "string" && v.startsWith(c.startsWith as string))) return false;
        return true;
      });
    updateMany.mockImplementation((async (arg: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows.filter((r) => matches(r, arg.where));
      for (const r of hit) Object.assign(r, arg.data);
      return { count: hit.length };
    }) as never);
    const { pruneNoise } = await import("@/lib/brain/memory-consolidation");
    await pruneNoise();
    expect(rows.find((r) => r.id === "sr")?.deletedAt).toBeNull();
    expect(rows.find((r) => r.id === "in")?.deletedAt).toBeInstanceOf(Date);
    updateMany.mockImplementation(async () => ({ count: 3 }));
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
