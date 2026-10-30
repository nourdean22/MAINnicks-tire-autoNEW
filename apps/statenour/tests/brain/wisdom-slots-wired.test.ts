/**
 * W2 wired · getContextualMemories with embeddings on (manager review of PR 3365).
 *
 * selectWisdomSlots refusing a row is not enough: the GUARANTEE TOP-3 and the
 * pad below it skip the 0.15 threshold and read straight from `scored`, so a
 * refused wisdom row (an archive chunk, a cron output, an under-floor row) came
 * back through them, with wisdom's category-lane lift behind it. Rows the slot
 * picker refused may only re-enter on the normal threshold, and known
 * non-wisdom payloads filed as wisdom (archive_* keys, cron:* sources) enter no
 * lane at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  exec: [] as { sql: string; params: unknown[] }[],
  memories: [] as Record<string, unknown>[],
  scores: [] as { id: string; score: number }[],
}));

vi.mock("@/lib/prisma", () => {
  const record = (sql: string) => {
    if (sql.includes('DISTINCT ON (ve."sourceId")')) return Promise.resolve(h.scores.map((s) => ({ ...s, json: null })));
    return Promise.resolve([]);
  };
  const exec = (sql: string, ...params: unknown[]) => {
    h.exec.push({ sql, params });
    return Promise.resolve(0);
  };
  const tx = { $queryRawUnsafe: (sql: string) => record(sql), $executeRawUnsafe: exec };
  const brainMemory = {
    findMany: vi.fn((args: { take?: number }) => Promise.resolve(args?.take === 300 ? h.memories : [])),
    updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    upsert: vi.fn(() => Promise.resolve({})),
  };
  const generic = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockResolvedValue({}),
  });
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "brainMemory") return brainMemory;
        if (prop === "$transaction") return (fn: (t: typeof tx) => unknown) => fn(tx);
        if (prop === "$queryRawUnsafe") return (sql: string) => record(sql);
        if (prop === "$executeRawUnsafe") return exec;
        if (prop === "$queryRaw") return () => Promise.resolve([{ extname: "vector" }]);
        return generic();
      },
    },
  );
  return { prisma };
});
vi.mock("@/lib/brain/embedding-utils", () => ({
  cosineSimilarity: () => 0.5,
  semanticSearch: vi.fn(() => Promise.resolve([])),
  storeMemoryEmbedding: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/brain/relational-graph", () => ({ getConnections: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/brain/rerank", () => ({ rerank: vi.fn(), isRerankAvailable: () => false }));
vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: false }) }));

import { getContextualMemories } from "@/lib/brain/contextual-recall";

const OLD = new Date("2026-09-01T00:00:00Z");
const row = (id: string, over: Record<string, unknown>) => ({
  id,
  category: "insight",
  key: `k_${id}`,
  content: `${id} note about the tire supplier invoice follow up`,
  confidence: 0.9,
  createdAt: OLD,
  updatedAt: OLD,
  lastSeen: OLD,
  source: "cron:x",
  seenCount: 1,
  validUntil: null,
  supersededById: null,
  expiresAt: null,
  validFrom: null,
  ...over,
});
const EMBED = [0.9, 0.1, 0.2, 0.3];
const run = () =>
  getContextualMemories(["what did the tire supplier say about the invoice"], 5, { fastTopics: true, queryEmbedding: EMBED });
const bumpIds = () => (h.exec.find((e) => /recallCount/.test(e.sql))?.params[0] as string[] | undefined) ?? [];
const flush = () => new Promise((r) => setTimeout(r, 0));

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.exec.length = 0;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => logSpy.mockRestore());

describe("refused wisdom stays out of the block", () => {
  it("an archive chunk at 0.9, a cron output at 0.9 and a curated row at 0.34 are all absent", async () => {
    h.memories = [
      row("arch", { category: "wisdom", key: "archive_756b_doc.txt_chunk71", source: "manual", content: "ARCHIVE chunk text tire supplier invoice" }),
      row("cron", { category: "wisdom", key: "move_2026-05-24_2", source: "cron:revenue-decision", content: "CRON move tire supplier invoice" }),
      row("under", { category: "wisdom", key: "wisdom_naval-ravikant_001", source: "manual", content: "UNDER floor curated tire supplier invoice" }),
      row("i1", {}), row("i2", {}), row("i3", {}), row("i4", {}),
    ];
    h.scores = [
      { id: "arch", score: 0.9 }, { id: "cron", score: 0.9 }, { id: "under", score: 0.34 },
      { id: "i1", score: 0.3 }, { id: "i2", score: 0.3 }, { id: "i3", score: 0.3 }, { id: "i4", score: 0.3 },
    ];
    const block = await run();
    await flush();
    expect(block).toContain("tire supplier invoice"); // POSITIVE CONTROL: the block rendered
    for (const tag of ["ARCHIVE", "CRON", "UNDER"]) expect(block).not.toContain(tag);
    expect(bumpIds()).not.toEqual(expect.arrayContaining(["arch"]));
    expect(bumpIds()).not.toEqual(expect.arrayContaining(["cron"]));
    expect(bumpIds()).not.toEqual(expect.arrayContaining(["under"]));
  });

  it("CONTROL: a curated row above the floor is forced in and bumped", async () => {
    h.memories = [
      row("good", { category: "wisdom", key: "wisdom_charlie-munger_001", source: "manual", content: "GOOD curated tire supplier invoice" }),
      row("i1", {}), row("i2", {}), row("i3", {}), row("i4", {}),
    ];
    h.scores = [{ id: "good", score: 0.6 }, { id: "i1", score: 0.3 }, { id: "i2", score: 0.3 }, { id: "i3", score: 0.3 }, { id: "i4", score: 0.3 }];
    const block = await run();
    await flush();
    expect(block).toContain("GOOD curated");
    expect(bumpIds()).toContain("good");
  });
});

describe("lastSeen reaches the slot picker", () => {
  it("a row recalled an hour ago loses its slot to rested peers", async () => {
    const recent = new Date(Date.now() - 3_600_000);
    h.memories = [
      row("recent", { category: "wisdom", key: "wisdom_naval-ravikant_002", source: "manual", lastSeen: recent, content: "RECENT curated tire supplier invoice" }),
      row("r1", { category: "wisdom", key: "wisdom_naval-ravikant_003", source: "manual", content: "REST1 curated tire supplier invoice" }),
      row("r2", { category: "wisdom", key: "wisdom_naval-ravikant_004", source: "manual", content: "REST2 curated tire supplier invoice" }),
      row("r3", { category: "wisdom", key: "wisdom_naval-ravikant_005", source: "manual", content: "REST3 curated tire supplier invoice" }),
      row("i1", {}),
    ];
    h.scores = [{ id: "recent", score: 0.62 }, { id: "r1", score: 0.6 }, { id: "r2", score: 0.6 }, { id: "r3", score: 0.6 }, { id: "i1", score: 0.3 }];
    await run();
    await flush();
    expect(bumpIds()).toEqual(expect.arrayContaining(["r1", "r2", "r3"]));
    expect(bumpIds()).not.toContain("recent");
  });
});
