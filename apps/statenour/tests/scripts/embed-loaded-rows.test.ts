/**
 * Brain backfill W2 (2026-10-30): the wisdom loaders wrote rows with no embedding, so the 300 Gracian rows
 * loaded at 03:19Z had 0 vectors 9 hours later and could not enter a wisdom slot (an unscored row drops
 * silently). The loaders now embed what they wrote, with the same text the nightly cron uses.
 *
 * Codex P1 on PR 3380: counting vector RECORDS reported a row as embedded when its record held the old text
 * or had no native pgvector column (storeGenericEmbedding swallows failures and does not await the native
 * write). A row counts only when its native vector exists AND the record holds the text just written.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { brainMemoryEmbedText } from "@/lib/brain/embedding-utils";
import { embedLoadedRows } from "@/scripts/_lib/embed-loaded-rows";

const rows = [
  { id: "a", category: "wisdom", key: "wisdom_baltasar-gracian_001", content: "Think with the few." },
  { id: "b", category: "wisdom", key: "wisdom_baltasar-gracian_002", content: "Know when to stop." },
];

type Vec = { sourceId: string; content: string; native: boolean };

/** A vector table the check queries the way the database would: native column present AND text equal to what was written. */
function deps(vectorsAfterWrite: Vec[], opts: { landAfterPolls?: number } = {}) {
  let polls = 0;
  const store = vi.fn(async () => {});
  const queryRawUnsafe = vi.fn(async (_sql: string, ids: string[], texts: string[]) => {
    polls++;
    if (opts.landAfterPolls && polls < opts.landAfterPolls) return [{ n: 0 }];
    const want = new Map(ids.map((id, i) => [id, texts[i]]));
    return [{ n: vectorsAfterWrite.filter((v) => v.native && want.get(v.sourceId) === v.content).length }];
  });
  const prisma = { brainMemory: { findMany: vi.fn(async () => rows) }, $queryRawUnsafe: queryRawUnsafe };
  return { store, prisma, queryRawUnsafe, pollMs: 0 };
}

const fresh = (id: "a" | "b"): Vec => ({ sourceId: id, content: brainMemoryEmbedText(rows.find((r) => r.id === id)!), native: true });

describe("embedLoadedRows", () => {
  it("embeds every row it was given with the nightly cron's text, and reports what landed", async () => {
    const d = deps([fresh("a"), fresh("b")]);
    expect(await embedLoadedRows(["a", "b"], d)).toEqual({ landed: 2, total: 2 });
    expect(d.store.mock.calls).toEqual([
      ["brain_memory", "a", "[wisdom] wisdom_baltasar-gracian_001: Think with the few."],
      ["brain_memory", "b", "[wisdom] wisdom_baltasar-gracian_002: Know when to stop."],
    ]);
    expect(d.prisma.brainMemory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["a", "b"] }, deletedAt: null } }),
    );
  });

  it("a record still holding the OLD text does not count (an update whose re-embed failed)", async () => {
    const d = deps([fresh("a"), { sourceId: "b", content: "[wisdom] wisdom_baltasar-gracian_002: an older wording", native: true }]);
    expect(await embedLoadedRows(["a", "b"], d)).toEqual({ landed: 1, total: 2 });
  });

  it("a record with no native pgvector column does not count (the KNN lane cannot see it)", async () => {
    const d = deps([fresh("a"), { ...fresh("b"), native: false }]);
    expect(await embedLoadedRows(["a", "b"], d)).toEqual({ landed: 1, total: 2 });
  });

  it("waits for the un-awaited native write instead of reading too early", async () => {
    const d = deps([fresh("a"), fresh("b")], { landAfterPolls: 3 });
    expect(await embedLoadedRows(["a", "b"], d)).toEqual({ landed: 2, total: 2 });
    expect(d.queryRawUnsafe).toHaveBeenCalledTimes(3);
  });

  it("the check reads the native column and the stored text, never record existence alone", async () => {
    const d = deps([fresh("a"), fresh("b")]);
    await embedLoadedRows(["a", "b"], d);
    const sql = String(d.queryRawUnsafe.mock.calls[0][0]).replace(/\s+/g, " ");
    expect(sql).toContain("embedding_vec_1536 IS NOT NULL"); // the column the recall KNN lane reads (contextual-recall getKnnPoolRows)
    expect(sql).toContain("v.content = w.text");
    expect(d.queryRawUnsafe.mock.calls[0][2]).toEqual(rows.map(brainMemoryEmbedText));
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
