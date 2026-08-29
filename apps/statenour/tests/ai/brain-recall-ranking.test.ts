/**
 * Recall must find what the operator actually stored.
 *
 * Two independent defects shipped together in the chat recall path, both
 * measured against production on 2026-08-29 before this test was written:
 *
 * 1. searchReflections ran a literal `contains` on the WHOLE query string
 *    while lib/ai/tool-families.ts advertised it as "FTS over journal
 *    reflections". Against a live corpus of 210 reflections + 1,181 brain
 *    dumps: "business" -> 71 hits, "mind your business" -> 0. Every
 *    natural-language ask the model emits for "have I thought about this
 *    before" returned nothing, and the operator saw stacked
 *    "REFLECTIONS FOUND · 0 matches" cards.
 *
 * 2. searchMemories computed ts_rank relevance and then THREW IT AWAY,
 *    ordering by `confidence` alone. All 7,059 `archive_*` bulk-ingest
 *    chunks sit at confidence 1.0; the operator's own pinned memory
 *    `mantra_mind_your_business` sits at 0.4. 36,761 of 38,311 live rows
 *    (96%) outranked it. Searching for that row BY ITS EXACT KEY returned
 *    ten archive chunks and not the row -- which is what made Nick tell the
 *    operator he could not confirm the memory existed.
 *
 * These assert BEHAVIOUR, not presence: each one is built so that reverting
 * the fix makes it fail. The ranking case in particular mirrors the
 * invariant already pinned in tests/brain/discoveries.test.ts ("orders by
 * RECENCY, never confidence") -- confidence is a re-sighting count, and
 * ranking a search by it buries exactly the deliberate, hand-pinned rows a
 * search is most likely to be looking for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { findMany: vi.fn() },
  reflection: { findMany: vi.fn() },
  brainDump: { findMany: vi.fn() },
  queryRawUnsafe: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
    reflection: mocks.reflection,
    brainDump: mocks.brainDump,
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));
vi.mock("@/lib/brain/blind-spot-detector", () => ({ detectBlindSpots: vi.fn(async () => []) }));
vi.mock("@/lib/brain/journal-ingest", () => ({ classifyThought: vi.fn() }));
vi.mock("@/lib/brain/knowledge-sync", () => ({ runKnowledgeSync: vi.fn() }));

import { brainTools } from "@/lib/ai/tools/brain";

type Executable = { execute: (args: any, opts?: unknown) => Promise<any> };
const searchMemories = brainTools.searchMemories as unknown as Executable;
const searchReflections = brainTools.searchReflections as unknown as Executable;

/** The operator's real pinned row, at its real confidence. */
const PINNED = {
  id: "pinned-1",
  key: "mantra_mind_your_business",
  category: "pinned_user",
  content: "Nour's core psychological pattern is avoidance and anxiety.",
  confidence: 0.4,
  source: "nick-tool:pinMemory",
  updatedAt: new Date("2026-07-01"),
};

/** Bulk-ingested archive chunks, all at the ceiling confidence. */
const ARCHIVE = Array.from({ length: 12 }, (_, i) => ({
  id: `archive-${i}`,
  key: `archive_c1f1b32a_PROMPT_SHADOW_JUDGE_QUEUE.md_chunk${i}`,
  category: "archive",
  content: "unrelated archived prose about queues and judging",
  confidence: 1,
  source: "drive-ingest",
  updatedAt: new Date("2026-08-01"),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRawUnsafe.mockResolvedValue([]);
});

describe("searchMemories · relevance outranks confidence", () => {
  it("returns the operator's pinned memory FIRST when searched by its exact key", async () => {
    // Every lane is asked; the key lane is the one that can see the pinned row.
    mocks.brainMemory.findMany.mockImplementation(async ({ where }: any) => {
      const match = where.AND[where.AND.length - 1];
      if (match?.key?.contains) return [PINNED];
      if (match?.content?.contains) return ARCHIVE;
      return [];
    });

    const out = await searchMemories.execute({
      query: "mantra_mind_your_business",
      minConfidence: 0.3,
      limit: 10,
    });

    expect(out.memories[0].key).toBe("mantra_mind_your_business");
    expect(out.count).toBeGreaterThan(0);
  });

  it("does not let confidence-1.0 archive bulk bury a confidence-0.4 pinned row", async () => {
    mocks.brainMemory.findMany.mockImplementation(async ({ where }: any) => {
      const match = where.AND[where.AND.length - 1];
      if (match?.key?.contains) return [PINNED];
      if (match?.content?.contains) return ARCHIVE;
      return [];
    });

    const out = await searchMemories.execute({ query: "mantra", minConfidence: 0.3, limit: 10 });
    const keys = out.memories.map((m: any) => m.key);
    const pinnedAt = keys.indexOf("mantra_mind_your_business");
    const firstArchiveAt = keys.findIndex((k: string) => k.startsWith("archive_"));

    // PRESENCE FIRST. Asserting only `pinnedAt < firstArchiveAt` scores GREEN
    // when the pinned row is absent entirely (indexOf -> -1, which is less
    // than any real index) — i.e. it passes hardest in the exact failure it
    // exists to catch. Caught by mutating the lane order during review.
    expect(pinnedAt).toBeGreaterThanOrEqual(0);
    expect(firstArchiveAt).toBeGreaterThanOrEqual(0);
    expect(pinnedAt).toBeLessThan(firstArchiveAt);
  });

  it("still honors the confidence floor, supersession and soft-delete", async () => {
    const seen: any[] = [];
    mocks.brainMemory.findMany.mockImplementation(async ({ where }: any) => {
      seen.push(where);
      return [];
    });

    await searchMemories.execute({ query: "anything", minConfidence: 0.7, limit: 5 });

    expect(seen.length).toBeGreaterThan(0);
    for (const where of seen) {
      expect(where.deletedAt).toBeNull();
      expect(where.supersededById).toBeNull();
      expect(where.AND).toContainEqual({ confidence: { gte: 0.7 } });
    }
  });
});

describe("searchReflections · multi-word queries must reach the corpus", () => {
  it("consults Postgres FTS, not only a whole-string substring match", async () => {
    mocks.reflection.findMany.mockResolvedValue([]);
    mocks.brainDump.findMany.mockResolvedValue([]);

    await searchReflections.execute({ query: "mind your business", limit: 8 });

    const sql = mocks.queryRawUnsafe.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toContain("websearch_to_tsquery");
    // Both sources, not just reflections -- the tool is documented as
    // covering Reflection insights AND BrainDump entries.
    expect(sql).toContain("FROM reflections");
    expect(sql).toContain("FROM brain_dumps");
  });

  it("feeds FTS ids into the row query so a phrase match is actually returned", async () => {
    mocks.queryRawUnsafe.mockImplementation(async (sqlText: string) =>
      String(sqlText).includes("FROM reflections") ? [{ id: "r-42" }] : [],
    );
    mocks.reflection.findMany.mockResolvedValue([
      { id: "r-42", date: "2026-08-01", category: "behavior", insight: "minding his own business", evidence: "", actionable: false },
    ]);
    mocks.brainDump.findMany.mockResolvedValue([]);

    const out = await searchReflections.execute({ query: "mind your business", limit: 8 });

    const where = mocks.reflection.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ id: { in: ["r-42"] } });
    expect(out.reflectionCount).toBe(1);
  });

  it("degrades to the substring match when FTS throws, rather than losing recall", async () => {
    mocks.queryRawUnsafe.mockRejectedValue(new Error("no such index"));
    mocks.reflection.findMany.mockResolvedValue([]);
    mocks.brainDump.findMany.mockResolvedValue([]);

    await expect(searchReflections.execute({ query: "discipline", limit: 8 })).resolves.toBeTruthy();

    const where = mocks.reflection.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ insight: { contains: "discipline", mode: "insensitive" } });
  });

  it("reports a total `count` covering BOTH sources, so the card cannot read 0 on a hit", async () => {
    // The exact production shape that made the card lie: no reflections,
    // one brain dump. The card reads `count ?? results ?? reflections.length`.
    mocks.reflection.findMany.mockResolvedValue([]);
    mocks.brainDump.findMany.mockResolvedValue([
      { id: "d-1", date: "2026-08-02", summary: "s", rawThoughts: "t", patterns: null, moodBefore: null },
    ]);

    const out = await searchReflections.execute({ query: "mantra", limit: 8 });

    expect(out.reflectionCount).toBe(0);
    expect(out.brainDumpCount).toBe(1);
    expect(out.count).toBe(1);
  });
});
