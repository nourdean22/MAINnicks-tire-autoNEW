/**
 * tests/brain/semantic-dedup-seen-count.test.ts (R3-14 item 4)
 *
 * runSemanticDedup merged near-duplicates with seenCount = winner + sum(losers).
 * Re-seeing the same claim is not new corroboration (05-X8, fixed the same way
 * in memory-consolidation.ts): the merged count is the MAX of the merged rows.
 *
 * The dedup runs for real on the JS-cosine path; only prisma, the pgvector
 * probe and the error logger are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  update: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/db/pgvector", () => ({ isPgvectorAvailable: vi.fn(async () => false) }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    brainMemory: { update: h.update, deleteMany: h.deleteMany },
    vectorEmbedding: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
  return {
    prisma: {
      brainMemory: {
        findMany: vi.fn(async ({ where }: { where: { category: string } }) =>
          where.category === "industry_intel" ? h.rows : [],
        ),
      },
      vectorEmbedding: {
        findMany: vi.fn(async ({ where }: { where: { sourceId: { in: string[] } } }) =>
          where.sourceId.in.map((id) => ({ sourceId: id, embedding: JSON.stringify([1, 0, 0]) })),
        ),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      auditEvent: { create: vi.fn(async () => ({})) },
    },
  };
});

import { runSemanticDedup } from "@/lib/brain/semantic-dedup";

const row = (id: string, confidence: number, seenCount: number, lastSeen: string) => ({
  id,
  category: "industry_intel",
  key: id,
  content: "Tire prices up 4% this quarter",
  confidence,
  seenCount,
  lastSeen: new Date(lastSeen),
  metadata: {},
  createdAt: new Date("2026-09-01T00:00:00Z"),
});

beforeEach(() => {
  h.update.mockReset().mockResolvedValue({});
  h.deleteMany.mockReset().mockResolvedValue({ count: 2 });
  // Sorted by confidence desc, as the real findMany orders them.
  h.rows = [
    row("winner", 0.9, 3, "2026-10-01T00:00:00Z"),
    row("loser-a", 0.8, 5, "2026-10-05T00:00:00Z"),
    row("loser-b", 0.7, 2, "2026-09-20T00:00:00Z"),
  ];
});

describe("semantic dedup merge", () => {
  it("the winner's seenCount is the max of the merged rows, not their sum", async () => {
    await runSemanticDedup();
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][0].data.seenCount).toBe(5);
  });

  it("CONTROL - the merge still happens: losers deleted, latest lastSeen kept", async () => {
    const res = await runSemanticDedup();
    expect(res.deleted).toBe(2);
    expect(h.deleteMany.mock.calls[0][0].where.id.in).toEqual(["loser-a", "loser-b"]);
    expect(h.update.mock.calls[0][0].where.id).toBe("winner");
    expect(h.update.mock.calls[0][0].data.lastSeen).toEqual(new Date("2026-10-05T00:00:00Z"));
  });
});
