/**
 * forget reports the search copy it left behind (audit tail T4).
 *
 * forgetMemoryById soft-deletes the memory, drops its embeddings, then reads
 * back the vector_embeddings rows. A failed read used to collapse into
 * `embeddingDropped: false`, the same answer as "rows are still there". The
 * count is now returned as `searchCopyRemaining`: a number when read, null when
 * the read failed (unknown, never zero).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  count: vi.fn(),
  softDelete: vi.fn(),
  drop: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { vectorEmbedding: { count: (...a: unknown[]) => h.count(...a) } },
}));
vi.mock("@/lib/db/soft-delete", () => ({ softDelete: (...a: unknown[]) => h.softDelete(...a) }));
vi.mock("@/lib/brain/memory-tombstone", () => ({ dropEmbeddingsForMemories: (...a: unknown[]) => h.drop(...a) }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: {} }));
vi.mock("@/lib/brain/memory-admission", () => ({ admitMemory: vi.fn() }));
vi.mock("@/lib/brain/memory-transaction-time", () => ({ supersedeMemoryVersion: vi.fn() }));

import { forgetMemoryById } from "@/lib/services/brain-memories";
import { searchCopyWarning } from "@/lib/brain/search-copy-status";

beforeEach(() => {
  vi.clearAllMocks();
  h.softDelete.mockResolvedValue({ ok: true, noop: false });
  h.drop.mockResolvedValue(undefined);
});

describe("forget reports the search copy it left behind", () => {
  it("2 vector rows still hold the text: searchCopyRemaining is 2 and the copy is not confirmed dropped", async () => {
    h.count.mockResolvedValue(2);

    const res = await forgetMemoryById("m1");

    expect(res).toMatchObject({ deleted: true, embeddingDropped: false, searchCopyRemaining: 2 });
  });

  it("a failed count is UNKNOWN (null), never zero", async () => {
    h.count.mockRejectedValue(new Error("db down"));

    const res = await forgetMemoryById("m1");

    expect(res.searchCopyRemaining).toBeNull();
    expect(res.embeddingDropped).toBe(false);
  });

  it("no rows left: searchCopyRemaining is 0 and the copy is confirmed dropped", async () => {
    h.count.mockResolvedValue(0);

    const res = await forgetMemoryById("m1");

    expect(res).toMatchObject({ deleted: true, embeddingDropped: true, searchCopyRemaining: 0 });
  });
});

describe("searchCopyWarning", () => {
  it("no copy left: no warning", () => {
    expect(searchCopyWarning(0)).toBeNull();
  });

  it("copies left: the warning names the count", () => {
    expect(searchCopyWarning(2)).toMatch(/2 search copies/);
  });

  it("unknown: the warning says it could not confirm the copy is gone", () => {
    expect(searchCopyWarning(null)).toMatch(/could not confirm/i);
  });
});
