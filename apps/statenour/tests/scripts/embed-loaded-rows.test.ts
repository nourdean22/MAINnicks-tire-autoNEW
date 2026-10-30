/**
 * Brain backfill W2 (2026-10-30): the wisdom loaders wrote rows with no embedding, so the 300 Gracian rows
 * loaded at 03:19Z had 0 vectors 9 hours later and could not enter a wisdom slot (an unscored row drops
 * silently). The loaders now embed what they wrote, with the same text the nightly cron uses.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { brainMemoryEmbedText } from "@/lib/brain/embedding-utils";
import { embedLoadedRows } from "@/scripts/_lib/embed-loaded-rows";

const rows = [
  { id: "a", category: "wisdom", key: "wisdom_baltasar-gracian_001", content: "Think with the few." },
  { id: "b", category: "wisdom", key: "wisdom_baltasar-gracian_002", content: "Know when to stop." },
];

function deps(landedIds: string[]) {
  const store = vi.fn(async () => {});
  const prisma = {
    brainMemory: { findMany: vi.fn(async () => rows) },
    vectorEmbedding: { count: vi.fn(async () => landedIds.length) },
  };
  return { store, prisma };
}

describe("embedLoadedRows", () => {
  it("embeds every row it was given with the nightly cron's text, and reports what landed", async () => {
    const d = deps(["a", "b"]);
    expect(await embedLoadedRows(["a", "b"], d)).toEqual({ landed: 2, total: 2 });
    expect(d.store.mock.calls).toEqual([
      ["brain_memory", "a", "[wisdom] wisdom_baltasar-gracian_001: Think with the few."],
      ["brain_memory", "b", "[wisdom] wisdom_baltasar-gracian_002: Know when to stop."],
    ]);
    expect(d.prisma.brainMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["a", "b"] }, deletedAt: null } }),
    );
  });

  it("counts by the vector rows that exist afterwards, not by calls returning (the store swallows failures)", async () => {
    const d = deps(["a"]);
    expect(await embedLoadedRows(["a", "b"], d)).toEqual({ landed: 1, total: 2 });
  });

  it("does nothing for an empty load", async () => {
    const d = deps([]);
    expect(await embedLoadedRows([], d)).toEqual({ landed: 0, total: 0 });
    expect(d.store).not.toHaveBeenCalled();
  });
});

describe("brainMemoryEmbedText", () => {
  it("is the exact string the embed-backfill cron has always written, so a loader vector is never re-embedded as stale", () => {
    expect(brainMemoryEmbedText({ category: "wisdom", key: "k", content: "c" })).toBe("[wisdom] k: c");
  });
});
