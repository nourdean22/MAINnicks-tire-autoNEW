/**
 * tests/brain/contradiction-resolution-supersedes.test.ts · 2026-09-07
 *
 * Closes the correction-to-recall loop. Every recall lane already filters
 * `supersededById: null AND (validUntil IS NULL OR validUntil > now)`
 * (lib/brain/contextual-recall.ts, cold-memory.ts, lib/ai/tools/brain.ts),
 * but `resolveContradiction` only floored the loser's confidence — so a
 * resolved contradiction still left both statements eligible as current
 * facts. Now the loser is superseded by the winner and closed at the moment
 * of resolution, and a near-duplicate `/save` pair enters this same flow.
 *
 * The prisma surface is mocked; the assertions are on the WRITES.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  auditEvent: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: mocks.brainMemory, auditEvent: mocks.auditEvent } }));
vi.mock("@/lib/brain/embedding-utils", () => ({ semanticSearch: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/brain/cross-system-nudge", () => ({ invalidateNudgeCache: vi.fn() }));
const cleanup = vi.hoisted(() => ({ cleanupResolvedContradiction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/brain/contradiction-cleanup", () => ({ cleanupResolvedContradiction: cleanup.cleanupResolvedContradiction }));

import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { buildContradictionKey, resolveContradiction, surfaceNearDuplicate } from "@/lib/brain/contradiction-surfacer";

const KEY = buildContradictionKey("bm-new", "bm-old");
const STORED = {
  new_memory_id: "bm-new",
  old_memory_id: "bm-old",
  similarity: 0.99,
  signal: "near_duplicate",
  new_excerpt: "Rent is $1,900 a month",
  old_excerpt: "Rent is $1,800 a month",
  days_apart: 37,
  surfaced_at: "2026-09-07T00:00:00.000Z",
  status: "unresolved",
};

describe("surfaceNearDuplicate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.brainMemory.upsert.mockResolvedValue({ id: "row" });
  });

  it("writes the pair into contradiction storage under a stable pair key", async () => {
    const key = await surfaceNearDuplicate({
      newMemoryId: "bm-new",
      oldMemoryId: "bm-old",
      newContent: "Rent is $1,900 a month",
      oldContent: "Rent is $1,800 a month",
      similarity: 0.99,
      oldCreatedAt: new Date(Date.now() - 10 * 86400_000),
    });
    expect(key).toBe(KEY);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    const call = mocks.brainMemory.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ category_key: { category: BRAIN_CATEGORIES.CONTRADICTION, key: KEY } });
    const stored = JSON.parse(call.create.content);
    expect(stored).toMatchObject({ signal: "near_duplicate", status: "unresolved", days_apart: 10 });
    // The update branch carries the same content — a re-save updates, never duplicates.
    expect(JSON.parse(call.update.content)).toMatchObject({ new_memory_id: "bm-new", old_memory_id: "bm-old" });
  });

  it("canary: a different pair gets a different key, the same pair the same key", () => {
    expect(buildContradictionKey("a", "b")).not.toBe(buildContradictionKey("b", "a"));
    expect(buildContradictionKey("a", "b")).toBe(buildContradictionKey("a", "b"));
  });
});

describe("resolveContradiction delegates memory-history mutation to one owner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cleanup.cleanupResolvedContradiction.mockResolvedValue(undefined);
    mocks.brainMemory.findUnique.mockResolvedValue({
      id: "row",
      content: JSON.stringify(STORED),
      createdAt: new Date("2026-09-07T00:00:00Z"),
    });
    mocks.brainMemory.update.mockResolvedValue({});
  });

  it("current_wins records the verdict then delegates exactly once", async () => {
    const out = await resolveContradiction(KEY, "current_wins", "the amount changed");
    expect(out?.status).toBe("current_wins");
    expect(cleanup.cleanupResolvedContradiction).toHaveBeenCalledOnce();
    expect(cleanup.cleanupResolvedContradiction).toHaveBeenCalledWith(
      "current_wins",
      "bm-new",
      "bm-old",
    );

    // The contradiction row itself is updated; neither memory is directly
    // superseded here. cleanupResolvedContradiction is the only history owner.
    const directMemoryWrites = mocks.brainMemory.update.mock.calls.filter(
      (call) => call[0].where?.id === "bm-old" || call[0].where?.id === "bm-new",
    );
    expect(directMemoryWrites).toEqual([]);
  });

  it("old_wins delegates the opposite winner/loser without a direct write", async () => {
    await resolveContradiction(KEY, "old_wins");
    expect(cleanup.cleanupResolvedContradiction).toHaveBeenCalledWith(
      "old_wins",
      "bm-new",
      "bm-old",
    );
    expect(
      mocks.brainMemory.update.mock.calls.some(
        (call) => call[0].where?.id === "bm-old" || call[0].where?.id === "bm-new",
      ),
    ).toBe(false);
  });

  it.each(["both_valid", "dismissed"] as const)(
    "%s still delegates so cleanup can apply the shared no-loser rule",
    async (status) => {
      await resolveContradiction(KEY, status);
      expect(cleanup.cleanupResolvedContradiction).toHaveBeenCalledWith(
        status,
        "bm-new",
        "bm-old",
      );
      expect(
        mocks.brainMemory.update.mock.calls.some(
          (call) => call[0].where?.id === "bm-old" || call[0].where?.id === "bm-new",
        ),
      ).toBe(false);
    },
  );
});
