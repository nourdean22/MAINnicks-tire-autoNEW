/**
 * 05-M12: forget or correct ONE recalled memory by id.
 *
 * forgetMemoryById reuses the soft-delete tombstone (deletedAt + audit) and
 * drops the vector_embeddings copy of the text. correctMemory writes a new
 * operator-stated row and supersedes the old one through
 * supersedeMemoryVersion, whose row lock is the compare-and-swap on the
 * version that was read: two corrections racing on one stale read -> exactly
 * one wins, and the loser removes its own new row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  confirm: vi.fn(),
  admitMemory: vi.fn(),
  supersede: vi.fn(),
  dropEmbeddings: vi.fn(),
  vecCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findUnique: m.findUnique, findFirst: m.findFirst, update: m.update },
    vectorEmbedding: { count: m.vecCount },
  },
}));
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { recall: vi.fn(), remember: vi.fn(), forget: vi.fn(), confirm: m.confirm },
}));
vi.mock("@/lib/brain/memory-admission", () => ({ admitMemory: m.admitMemory }));
vi.mock("@/lib/brain/memory-transaction-time", () => ({ supersedeMemoryVersion: m.supersede }));
vi.mock("@/lib/brain/memory-tombstone", () => ({ dropEmbeddingsForMemories: m.dropEmbeddings }));
vi.mock("@/lib/db/entity-audit", () => ({ logSoftDelete: vi.fn(), logRestore: vi.fn() }));

import {
  correctMemory,
  forgetMemoryById,
  MemoryNotCurrentError,
} from "@/lib/services/brain-memories";

/** A tiny in-memory row store behind findUnique/update, so softDelete runs for real. */
const rows = new Map<string, { id: string; deletedAt: Date | null }>();

beforeEach(() => {
  vi.clearAllMocks();
  rows.clear();
  m.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null);
  m.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { deletedAt: Date } }) => {
    const r = { ...rows.get(where.id)!, ...data };
    rows.set(where.id, r);
    return r;
  });
  m.dropEmbeddings.mockResolvedValue(1);
  m.vecCount.mockResolvedValue(0);
  m.confirm.mockResolvedValue({});
});

describe("forgetMemoryById", () => {
  it("sets deletedAt and drops the embedding copy; a second call is deleted:false", async () => {
    rows.set("mem-1", { id: "mem-1", deletedAt: null });

    await expect(forgetMemoryById("mem-1")).resolves.toEqual({ deleted: true, embeddingDropped: true, searchCopyRemaining: 0 });
    expect(rows.get("mem-1")!.deletedAt).toBeInstanceOf(Date);
    expect(m.dropEmbeddings).toHaveBeenCalledWith(["mem-1"], expect.any(String));

    // R3-16: the second call used to skip the drop, so a failed first drop was never repaired.
    m.dropEmbeddings.mockClear();
    await expect(forgetMemoryById("mem-1")).resolves.toEqual({ deleted: false, embeddingDropped: true, searchCopyRemaining: 0 });
    expect(m.dropEmbeddings).toHaveBeenCalledWith(["mem-1"], expect.any(String));
  });

  it("an unknown id is deleted:false, not a throw", async () => {
    await expect(forgetMemoryById("nope")).resolves.toEqual({ deleted: false });
    expect(m.update).not.toHaveBeenCalled();
  });
});

/**
 * R3-16 item 8 (review R3 wave A, finding 6) - the embedding drop swallows its
 * own failure (returns 0), so forget said deleted:true while the text copy
 * stayed in vector_embeddings, and a retry hit the noop path and never tried
 * the drop again. The drop now runs on the noop path too, and the result says
 * whether the copy is confirmed gone.
 */
describe("forgetMemoryById - a failed embedding drop is visible and retry-able", () => {
  it("the drop failed (copy still there): deleted:true but embeddingDropped:false", async () => {
    rows.set("mem-1", { id: "mem-1", deletedAt: null });
    m.dropEmbeddings.mockResolvedValue(0);
    m.vecCount.mockResolvedValue(1);
    await expect(forgetMemoryById("mem-1")).resolves.toEqual({ deleted: true, embeddingDropped: false, searchCopyRemaining: 1 });
  });

  it("a retry on the already-forgotten row drops the copy again and confirms it", async () => {
    rows.set("mem-1", { id: "mem-1", deletedAt: new Date() });
    m.vecCount.mockResolvedValue(0);
    await expect(forgetMemoryById("mem-1")).resolves.toEqual({ deleted: false, embeddingDropped: true, searchCopyRemaining: 0 });
    expect(m.dropEmbeddings).toHaveBeenCalledWith(["mem-1"], expect.any(String));
  });

  it("the read-back fails: unconfirmed, never reported as dropped", async () => {
    rows.set("mem-1", { id: "mem-1", deletedAt: null });
    m.vecCount.mockRejectedValue(new Error("connection reset"));
    // searchCopyRemaining is null here: the read-back failed, so the count is unknown, never 0.
    await expect(forgetMemoryById("mem-1")).resolves.toEqual({ deleted: true, embeddingDropped: false, searchCopyRemaining: null });
  });
});

describe("correctMemory", () => {
  const OLD = { id: "old-1", category: "identity", key: "home_city" };

  it("reads only the CURRENT version (live, not superseded)", async () => {
    m.findFirst.mockResolvedValue(null);
    await expect(correctMemory("old-1", "Lives in Parma")).rejects.toBeInstanceOf(MemoryNotCurrentError);
    expect(m.findFirst.mock.calls[0][0].where).toMatchObject({ id: "old-1", deletedAt: null, supersededById: null });
    expect(m.admitMemory).not.toHaveBeenCalled();
  });

  it("writes a new operator-stated row with no probation and supersedes the old one", async () => {
    m.findFirst.mockResolvedValue(OLD);
    m.admitMemory.mockResolvedValue({ id: "new-1" });
    m.supersede.mockResolvedValue({ count: 1, transactionStamped: false });

    await expect(correctMemory("old-1", "  Lives in Parma ")).resolves.toEqual({ id: "new-1" });

    const admitted = m.admitMemory.mock.calls[0][0];
    expect(admitted).toMatchObject({ category: "identity", content: "Lives in Parma", source: "manual", trustTier: "OPERATOR" });
    expect(admitted.key).not.toBe("home_city"); // (category, key) is unique: same key would reinforce the old row
    expect(m.confirm).toHaveBeenCalledWith("new-1");
    expect(m.supersede).toHaveBeenCalledWith(
      expect.objectContaining({ losingMemoryId: "old-1", winningMemoryId: "new-1" }),
    );
  });

  it("a failure after the new row is admitted removes it, so the old row stays the only current one", async () => {
    m.findFirst.mockResolvedValue(OLD);
    m.admitMemory.mockResolvedValue({ id: "new-x" });
    rows.set("new-x", { id: "new-x", deletedAt: null });
    m.supersede.mockRejectedValue(new Error("connection reset"));

    await expect(correctMemory("old-1", "Lives in Parma")).rejects.toThrow("connection reset");
    expect(rows.get("new-x")!.deletedAt).toBeInstanceOf(Date);
  });

  it("two corrections racing on one stale read: exactly one wins, the loser removes its own row", async () => {
    m.findFirst.mockResolvedValue(OLD); // both callers read the same live version
    m.admitMemory.mockResolvedValueOnce({ id: "new-a" }).mockResolvedValueOnce({ id: "new-b" });
    rows.set("new-a", { id: "new-a", deletedAt: null });
    rows.set("new-b", { id: "new-b", deletedAt: null });
    m.supersede
      .mockResolvedValueOnce({ count: 1, transactionStamped: false })
      .mockResolvedValueOnce({ count: 0, transactionStamped: false });

    const results = await Promise.allSettled([
      correctMemory("old-1", "Lives in Parma"),
      correctMemory("old-1", "Lives in Lakewood"),
    ]);

    expect(results[0]).toEqual({ status: "fulfilled", value: { id: "new-a" } });
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(MemoryNotCurrentError);
    expect(rows.get("new-b")!.deletedAt).toBeInstanceOf(Date);
    expect(rows.get("new-a")!.deletedAt).toBeNull();
  });
});
