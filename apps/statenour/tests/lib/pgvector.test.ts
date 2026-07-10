/**
 * Tests for lib/db/pgvector.ts (v8.4 BATCH 22).
 *
 * Pure-function bits covered. Live extension probe + KNN are
 * verified with mock prisma.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  unsafeQuery: vi.fn(),
  unsafeExec: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => mocks.queryRaw(...a),
    $executeRaw: (...a: unknown[]) => mocks.executeRaw(...a),
    $executeRawUnsafe: (...a: unknown[]) => mocks.unsafeExec(...a),
    $queryRawUnsafe: (...a: unknown[]) => mocks.unsafeQuery(...a),
  },
}));

import {
  vectorLiteral,
  isPgvectorAvailable,
  enablePgvector,
  knnSearch,
  bustPgvectorCache,
} from "@/lib/db/pgvector";

beforeEach(() => {
  vi.clearAllMocks();
  bustPgvectorCache();
});

describe("vectorLiteral", () => {
  it("formats a normal embedding as [a,b,c]", () => {
    expect(vectorLiteral([1.5, 2.25, 3])).toBe("[1.5,2.25,3]");
  });

  it("replaces NaN and Infinity with 0 (pgvector rejects them)", () => {
    expect(vectorLiteral([1, NaN, 3, Infinity, -Infinity])).toBe("[1,0,3,0,0]");
  });

  it("handles empty array", () => {
    expect(vectorLiteral([])).toBe("[]");
  });
});

describe("isPgvectorAvailable", () => {
  it("returns true when pg_extension has 'vector'", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ extname: "vector" }]);
    expect(await isPgvectorAvailable()).toBe(true);
  });

  it("returns false when extension absent", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    expect(await isPgvectorAvailable()).toBe(false);
  });

  it("returns false on probe error", async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error("boom"));
    expect(await isPgvectorAvailable()).toBe(false);
  });

  it("caches positive answer for 5min (only one DB call across calls)", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ extname: "vector" }]);
    await isPgvectorAvailable();
    await isPgvectorAvailable();
    await isPgvectorAvailable();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });
});

describe("enablePgvector", () => {
  it("runs CREATE EXTENSION + busts cache + reprobes", async () => {
    mocks.executeRaw.mockResolvedValueOnce(0);
    mocks.queryRaw.mockResolvedValueOnce([{ extname: "vector" }]);
    const result = await enablePgvector();
    expect(result).toBe(true);
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(String(mocks.executeRaw.mock.calls[0][0])).toContain("CREATE EXTENSION");
  });

  it("returns false on CREATE failure", async () => {
    mocks.executeRaw.mockRejectedValueOnce(new Error("permission denied"));
    expect(await enablePgvector()).toBe(false);
  });
});

describe("knnSearch", () => {
  it("returns null when extension unavailable", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    const r = await knnSearch([0.1, 0.2, 0.3]);
    expect(r).toBeNull();
  });

  it("queries with cosine operator by default", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ extname: "vector" }]);
    mocks.unsafeQuery.mockResolvedValueOnce([
      { id: "a", sourceType: "brain_memory", sourceId: "x", content: "hi", distance: 0.1 },
    ]);
    const r = await knnSearch([0.1, 0.2, 0.3]);
    expect(r).toEqual([
      { id: "a", sourceType: "brain_memory", sourceId: "x", content: "hi", distance: 0.1 },
    ]);
    const sql = mocks.unsafeQuery.mock.calls[0][0] as string;
    expect(sql).toContain("<=>");
  });

  it("uses L2 operator when metric=l2", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ extname: "vector" }]);
    mocks.unsafeQuery.mockResolvedValueOnce([]);
    await knnSearch([0.1], { metric: "l2" });
    const sql = mocks.unsafeQuery.mock.calls[0][0] as string;
    expect(sql).toContain("<->");
    expect(sql).not.toContain("<=>");
  });

  it("filters by sourceType when provided", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ extname: "vector" }]);
    mocks.unsafeQuery.mockResolvedValueOnce([]);
    await knnSearch([0.1], { sourceType: "brain_memory" });
    const sql = mocks.unsafeQuery.mock.calls[0][0] as string;
    expect(sql).toContain('WHERE "sourceType" = $1');
    expect(mocks.unsafeQuery.mock.calls[0][1]).toBe("brain_memory");
  });

  it("returns null + caches negative when query throws (column missing)", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ extname: "vector" }]);
    mocks.unsafeQuery.mockRejectedValueOnce(
      new Error('column "embedding_vec" does not exist'),
    );
    const r = await knnSearch([0.1]);
    expect(r).toBeNull();
    // Next call should hit the cached negative — no new probe.
    mocks.queryRaw.mockClear();
    const r2 = await knnSearch([0.1]);
    expect(r2).toBeNull();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
