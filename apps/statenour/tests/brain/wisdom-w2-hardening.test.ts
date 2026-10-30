/**
 * W2 hardening (manager review of PR 3365, 2026-10-30) · the wisdom-slot failure paths.
 *
 * Each read or write around the forced wisdom slots can fail on its own; none may take the
 * memory block down, penalize a row, or fail silently. Plus the keyword-mode floor with the
 * real keywordScore, an empty wisdom pool, and the decay against Postgres timestamp text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  exec: [] as { sql: string; params: unknown[] }[],
  memories: [] as Record<string, unknown>[],
  scores: [] as { id: string; score: number }[],
  meta: {} as Record<string, Record<string, unknown>>,
  metaReads: [] as string[],
  metaCalls: 0,
  metaFail: false,
  bumpFail: false,
  logError: vi.fn(),
}));

vi.mock("@/lib/utils/error-log", () => ({ logError: h.logError }));
vi.mock("@/lib/prisma", () => {
  const record = (sql: string) => {
    if (sql.includes('DISTINCT ON (ve."sourceId")')) return Promise.resolve(h.scores.map((s) => ({ ...s, json: null })));
    return Promise.resolve([]);
  };
  const exec = (sql: string, ...params: unknown[]) => {
    h.exec.push({ sql, params });
    if (h.bumpFail && /recallCount/.test(sql)) return Promise.reject(new Error("neon down"));
    return Promise.resolve(0);
  };
  const tx = { $queryRawUnsafe: (sql: string) => record(sql), $executeRawUnsafe: exec };
  const brainMemory = {
    findMany: vi.fn((args: { take?: number; where?: { id?: { in: string[] } } }) => {
      if (args?.take === 300) return Promise.resolve(h.memories);
      const ids = args?.where?.id?.in;
      if (ids) {
        h.metaCalls++;
        h.metaReads.push(...ids);
        if (h.metaFail) return Promise.reject(new Error("neon down"));
      }
      return Promise.resolve(ids ? ids.filter((id) => h.meta[id]).map((id) => ({ id, metadata: h.meta[id] })) : []);
    }),
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

import {
  getContextualMemories,
  keywordScore,
  selectWisdomSlots,
  wisdomSlotCounts,
  WISDOM_SLOT_MIN_KEYWORD,
} from "@/lib/brain/contextual-recall";

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
const run = (q = "what did the tire supplier say about the invoice") =>
  getContextualMemories([q], 5, { fastTopics: true, queryEmbedding: EMBED });
const bump = () => h.exec.find((e) => /recallCount/.test(e.sql));
const flush = () => new Promise((r) => setTimeout(r, 0));
const slotLog = () =>
  logSpy.mock.calls.find((c) => c[0] === "[brain-recall] wisdom_slots")?.[1] as Record<string, unknown> | undefined;
const errFns = () => h.logError.mock.calls.map((c) => (c[2] as { fn?: string } | undefined)?.fn);

const GOOD = () => [
  row("good", { category: "wisdom", key: "wisdom_charlie-munger_001", source: "manual", content: "GOOD curated tire supplier invoice" }),
  row("i1", {}), row("i2", {}), row("i3", {}), row("i4", {}),
];
const GOOD_SCORES = [{ id: "good", score: 0.6 }, { id: "i1", score: 0.3 }, { id: "i2", score: 0.3 }, { id: "i3", score: 0.3 }, { id: "i4", score: 0.3 }];

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => unhandled.push(e);
beforeEach(() => {
  h.exec.length = 0;
  h.meta = {};
  h.metaReads.length = 0;
  h.metaCalls = 0;
  h.metaFail = false;
  h.bumpFail = false;
  h.logError.mockClear();
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("a failed recall bump", () => {
  it("still returns the block with the wisdom row, logs a warn as wisdomRecallBump, leaves nothing unhandled", async () => {
    h.bumpFail = true;
    h.memories = GOOD();
    h.scores = GOOD_SCORES;
    const block = await run();
    await flush();
    await flush();
    expect(block).toContain("GOOD curated");
    expect(bump()).toBeDefined(); // POSITIVE CONTROL: the bump was attempted
    expect(errFns()).toContain("wisdomRecallBump");
    expect(unhandled).toEqual([]);
  });
});

describe("a failed by-id metadata read", () => {
  it("fails open: the block renders, the curated row keeps its slot on key prefix, no penalty, warn logged, wisdomMetaOk false", async () => {
    h.metaFail = true;
    h.memories = GOOD();
    h.scores = GOOD_SCORES;
    const block = await run();
    await flush();
    expect(h.metaReads).toContain("good"); // POSITIVE CONTROL: the read ran and failed
    expect(block).toContain("GOOD curated");
    expect((bump()?.params[0] as string[]) ?? []).toContain("good");
    expect(errFns()).toContain("attachWisdomOrigins");
    expect(slotLog()?.wisdomMetaOk).toBe(false);
  });

  it("CONTROL: a successful read logs wisdomMetaOk true", async () => {
    h.memories = GOOD();
    h.scores = GOOD_SCORES;
    await run();
    expect(slotLog()?.wisdomMetaOk).toBe(true);
  });
});

describe("keyword-mode floor (fewer than 5 vectors)", () => {
  it.each([
    [8 / 12, 0],
    [9 / 12, 1],
    [10 / 12, 1],
  ])("keyword score %s gives %s row(s)", (semantic, n) => {
    const r = { id: "w", category: "wisdom", key: "wisdom_naval-ravikant_001", source: "manual", hybrid: 0.5, semantic };
    expect(selectWisdomSlots([r], 3, { useEmbeddings: false, now: new Date() })).toHaveLength(n);
  });

  it("wired: with no vectors a 2-hit wisdom row stays out and a 3-hit row gets in, on the real keywordScore", async () => {
    const q = "alternator warranty brakes";
    const two = { category: "wisdom", key: "wisdom_naval-ravikant_002", source: "manual", content: "TWOHIT alternator warranty note" };
    const three = { category: "wisdom", key: "wisdom_naval-ravikant_003", source: "manual", content: "THREEHIT alternator warranty brakes note" };
    const topics = ["brakes", "warranty", "alternator"];
    expect(keywordScore(two, topics)).toBe(6 / 12);
    expect(keywordScore(three, topics)).toBe(WISDOM_SLOT_MIN_KEYWORD);
    h.memories = [row("two", two), row("three", three), row("i1", {})];
    h.scores = []; // under 5 vectors: the semantic lane is off, recall runs in keyword mode
    const block = await getContextualMemories([q], 5, { fastTopics: true, queryEmbedding: EMBED });
    await flush();
    expect(warnSpy.mock.calls.some((c) => c[0] === "[brain-recall] semantic_lane_off")).toBe(true);
    expect(block).toContain("THREEHIT");
    expect(block).not.toContain("TWOHIT");
  });
});

describe("an empty wisdom pool", () => {
  it("selectWisdomSlots([]) is [] and every count is zero", () => {
    expect(selectWisdomSlots([], 3, { useEmbeddings: true, now: new Date() })).toEqual([]);
    expect(wisdomSlotCounts([], { useEmbeddings: true, scoredIds: new Set() })).toEqual({
      wisdomPool: 0,
      wisdomUnscored: 0,
      wisdomPassedFloor: 0,
      wisdomAllowlistRejected: 0,
    });
  });

  it("wired: no by-id read, no bump UPDATE, the block still renders, and the log carries the pool sizes", async () => {
    h.memories = [row("i1", {}), row("i2", {}), row("i3", {}), row("i4", {}), row("i5", {})];
    h.scores = [1, 2, 3, 4, 5].map((i) => ({ id: `i${i}`, score: 0.3 }));
    const block = await run();
    await flush();
    expect(block).toContain("tire supplier invoice");
    expect(h.metaCalls).toBe(0);
    expect(bump()).toBeUndefined();
    expect(slotLog()).toMatchObject({ wisdomPool: 0, wisdomInjected: 0, candidatePool: 5, knnRows: 0 });
  });
});

describe("decay against stored timestamp text", () => {
  const NOW = new Date("2026-10-29T23:00:00Z");
  const pair = (recalled: string | null) => [
    { id: "recent", category: "wisdom", key: "wisdom_naval-ravikant_001", source: "manual", hybrid: 0.6, semantic: 0.5, lastRecalledAt: recalled },
    { id: "rested", category: "wisdom", key: "wisdom_charlie-munger_002", source: "manual", hybrid: 0.5, semantic: 0.5, lastRecalledAt: null },
  ];
  const winner = (recalled: string | null) => selectWisdomSlots(pair(recalled), 1, { useEmbeddings: true, now: NOW })[0]?.id;

  it("Postgres to_jsonb(NOW()) text (microseconds, +00:00) an hour ago is penalized", () => {
    expect(winner("2026-10-29T22:00:00.123456+00:00")).toBe("rested");
  });
  it("garbage text gives no penalty and does not throw", () => {
    expect(winner("not a timestamp")).toBe("recent");
  });
  it("exactly 24 hours ago is not penalized", () => {
    expect(winner("2026-10-28T23:00:00.000000+00:00")).toBe("recent");
  });
});
