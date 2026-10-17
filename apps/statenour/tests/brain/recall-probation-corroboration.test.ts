/**
 * tests/brain/recall-probation-corroboration.test.ts · 2026-10-10 (audit wave 2, Task 9)
 *
 * Findings 05-M13, 05-M5, 05-M6, 05-M8, plus the 05-M2 read-side wiring.
 *
 *  M13 · the contextual lexical lane filtered categories in JS AFTER `LIMIT 50`,
 *        so quarantined rows (semantic_edge telemetry) could fill every slot.
 *  M5  · a remember() row is on a 24h probation (expires_at), but no recall
 *        lane read expires_at, so an unreinforced row recalled forever.
 *  M6  · contextual recall incremented wisdom seenCount on every read, so being
 *        recalled counted as corroboration ("seen Nx", decay exemption); and
 *        memory-recall's lastSeen bump fed its own +0.2 recency boost.
 *  M8  · no KNN reader filtered vector_embeddings.model, so vectors from
 *        another embedding space ranked beside the active one.
 *  M2  · hybrid recall re-derived the trust tier from `source` alone, ignoring
 *        the stored trust_tier and the admission envelope.
 *  Private Lab · contextual recall wrote on read, so private turns skipped it.
 *
 * The SQL assertions read the statement the code actually sends (captured from
 * a prisma double), not the source file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sql: [] as { sql: string; params: unknown[] }[],
  exec: [] as { sql: string; params: unknown[] }[],
  updateMany: [] as unknown[],
  findManyWhere: [] as unknown[],
  memories: [] as unknown[],
  knnRows: [] as unknown[],
}));

vi.mock("@/lib/prisma", () => {
  const record = (sql: string, params: unknown[]) => {
    h.sql.push({ sql, params });
    if (sql.includes("embedding_vec_1536 <=>") && !sql.includes("DISTINCT ON")) return Promise.resolve(h.knnRows);
    if (/SELECT COUNT\(\*\)/i.test(sql) && sql.includes("FROM brain_memories")) return Promise.resolve([{ n: 7 }]);
    return Promise.resolve([]);
  };
  const exec = (sql: string, ...params: unknown[]) => {
    h.exec.push({ sql, params });
    return Promise.resolve(params.length > 0 ? 3 : 0);
  };
  const tx = {
    $queryRawUnsafe: (sql: string, ...params: unknown[]) => record(sql, params),
    $executeRawUnsafe: exec,
  };
  const brainMemory = {
    findMany: vi.fn((args: { take?: number; where?: unknown }) => {
      if (args?.take === 300) {
        h.findManyWhere.push(args.where);
        return Promise.resolve(h.memories);
      }
      return Promise.resolve([]);
    }),
    updateMany: vi.fn((args: unknown) => {
      h.updateMany.push(args);
      return Promise.resolve({ count: 0 });
    }),
    create: vi.fn((args: unknown) => (h.updateMany.push({ op: "create", args }), Promise.resolve({}))),
    update: vi.fn((args: unknown) => (h.updateMany.push({ op: "update", args }), Promise.resolve({}))),
    upsert: vi.fn((args: unknown) => (h.updateMany.push({ op: "upsert", args }), Promise.resolve({}))),
  };
  const generic = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    // Every write op on every other model lands in h.updateMany, so the
    // private-turn assertion covers the whole client, not one table.
    ...Object.fromEntries(
      ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"].map((op) => [
        op,
        vi.fn((args: unknown) => {
          h.updateMany.push({ op, args });
          return Promise.resolve({ count: 0 });
        }),
      ]),
    ),
  });
  const named: Record<string, unknown> = { brainMemory };
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop in named) return named[prop];
        if (prop === "$transaction") return (fn: (t: typeof tx) => unknown) => fn(tx);
        if (prop === "$queryRawUnsafe") return (sql: string, ...params: unknown[]) => record(sql, params);
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

import { RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";
import { getContextualMemories, getLexicalMatches } from "@/lib/brain/contextual-recall";
import { recallMemoriesForQuery } from "@/lib/brain/memory-recall";
import { knnSearch, embeddingSpaceSql, bustPgvectorCache } from "@/lib/db/pgvector";
import { runMemoryDecay } from "@/lib/brain/memory-manager";
import { NEVER_HARD_DELETE_CATEGORIES } from "@/lib/brain/hard-delete-guard";
import { withTurnContext } from "@/lib/agent/turn-context";

const NOT_EXPIRED = /\(bm\.expires_at IS NULL OR bm\.expires_at > NOW\(\)\)/;
const EMBED = [0.9, 0.1, 0.2, 0.3];

const MEMORIES = Array.from({ length: 8 }, (_, i) => ({
  id: `m${i}`,
  category: i < 2 ? "wisdom" : "insight",
  key: `k${i}`,
  content: `memory ${i} about the tire supplier invoice and follow up ${i}`,
  confidence: 0.9 - i * 0.05,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  source: "manual",
  seenCount: 2,
  updatedAt: new Date("2026-09-01T00:00:00Z"),
}));

const runContextual = () =>
  getContextualMemories(["what did the tire supplier say about the invoice"], 5, {
    fastTopics: true,
    queryEmbedding: EMBED,
  });

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.sql.length = 0;
  h.exec.length = 0;
  h.updateMany.length = 0;
  h.findManyWhere.length = 0;
  h.memories = MEMORIES;
  h.knnRows = [];
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * Writes the recall path made. One is excluded BY SIGNATURE: under vitest,
 * lib/ai/tool-result-fencing.ts's CJS `require("@/lib/ai/tool-result-classifier")`
 * cannot resolve the alias, and logError records that as an ErrorLog row with
 * no user text. The bundled app resolves it; the row is a harness artifact.
 */
const recallWrites = () =>
  h.updateMany.filter(
    (w) => (w as { args?: { data?: { context?: { fn?: string } } } }).args?.data?.context?.fn !== "fenceContent.require",
  );

describe("M13 · contextual lexical lane filters categories in SQL", () => {
  it("the FTS statement excludes RECALL_EXCLUDE_CATEGORIES before LIMIT", async () => {
    await getLexicalMatches(["tire", "supplier", "invoice"], 50);
    const q = h.sql.find((s) => s.sql.includes("websearch_to_tsquery"));
    expect(q, "lexical statement was sent").toBeDefined();
    const m = q!.sql.match(/bm\.category <> ALL\(\$(\d+)::text\[\]\)/);
    expect(m, "category exclusion in SQL").not.toBeNull();
    expect(q!.params[Number(m![1]) - 1]).toEqual([...RECALL_EXCLUDE_CATEGORIES]);
    expect(q!.sql.indexOf("<> ALL")).toBeLessThan(q!.sql.indexOf("LIMIT"));
  });

  it("as-of mode keeps the parameters aligned ($2 categories, $3 asOf)", async () => {
    const asOf = new Date("2026-09-01T00:00:00Z");
    await getLexicalMatches(["tire", "supplier"], 50, asOf);
    const q = h.sql.find((s) => s.sql.includes("websearch_to_tsquery"))!;
    expect(q.sql).toMatch(/<> ALL\(\$2::text\[\]\)/);
    expect(q.sql).toContain("$3");
    expect(q.params[2]).toBe(asOf);
  });
});

describe("M5 · probation (expires_at) is honoured by every recall lane", () => {
  it("contextual lexical + KNN pool SQL and the top-300 pool filter expired rows", async () => {
    await runContextual();
    const lexical = h.sql.find((s) => s.sql.includes("websearch_to_tsquery"))!;
    const knn = h.sql.find((s) => s.sql.includes("FROM vector_embeddings ve") && s.sql.includes("LIMIT"))!;
    expect(lexical.sql).toMatch(NOT_EXPIRED);
    expect(knn.sql).toMatch(NOT_EXPIRED);
    const where = JSON.stringify(h.findManyWhere[0]);
    expect(where).toContain('{"OR":[{"expiresAt":null},{"expiresAt":{"gt":');
  });

  it("all four hybrid-recall lanes filter expired rows", async () => {
    await recallMemoriesForQuery("the tire supplier invoice", {
      embedding: Array.from({ length: 1024 }, () => 0.01),
      exactTerms: ["BDN-310"],
      sideEffects: false,
    });
    const lanes = h.sql.filter((s) => s.sql.includes("FROM brain_memories bm") || s.sql.includes("JOIN brain_memories bm"));
    expect(lanes.length).toBe(4);
    for (const l of lanes) expect(l.sql).toMatch(NOT_EXPIRED);
  });
});

describe("M6 · being recalled is not corroboration", () => {
  it("wisdom recall never increments seenCount; it records recallCount + lastSeen instead", async () => {
    await runContextual();
    await flush();
    for (const u of h.updateMany) expect(JSON.stringify(u)).not.toContain("seenCount");
    const bump = h.exec.find((e) => /UPDATE brain_memories/.test(e.sql));
    expect(bump, "recall bump ran").toBeDefined();
    expect(bump!.sql).toContain("recallCount");
    expect(bump!.sql).toContain("last_seen = NOW()");
    expect(bump!.sql).not.toMatch(/seen_count/);
    expect(bump!.params[0]).toEqual(expect.arrayContaining(["m0", "m1"]));
  });

  it("a single-sighting row gets no recency boost from a fresh lastSeen; a re-sighted row does", async () => {
    const now = new Date();
    const old = new Date(Date.now() - 200 * 86_400_000);
    const base = {
      category: "insight",
      key: "k",
      content: "tire supplier invoice",
      confidence: 0.5,
      last_seen: now,
      created_at: old,
      distance: 0.5,
      source: "manual",
      created_by: "user",
      trust_tier: null,
      admission: null,
    };
    h.knnRows = [
      { ...base, memory_id: "once", seen_count: 1 },
      { ...base, memory_id: "thrice", seen_count: 3 },
    ];
    const r = await recallMemoriesForQuery("tire supplier invoice", {
      embedding: Array.from({ length: 1024 }, () => 0.01),
      sideEffects: false,
    });
    const once = r.hits.find((x) => x.memoryId === "once")!;
    const thrice = r.hits.find((x) => x.memoryId === "thrice")!;
    expect(once.finalScore).toBeCloseTo(0.5 + 0.15, 3);
    expect(thrice.finalScore).toBeCloseTo(0.5 + 0.2 + 0.15, 3);
  });
});

describe("M2 · hybrid recall resolves the stored trust tier", () => {
  it("selects trust_tier + admission and tightens a source-derived SYSTEM_DERIVED row", async () => {
    const row = {
      category: "insight",
      key: "k",
      content: "tire supplier invoice",
      confidence: 0.5,
      seen_count: 1,
      last_seen: new Date(),
      created_at: new Date(),
      distance: 0.3,
      created_by: "system",
    };
    h.knnRows = [
      { ...row, memory_id: "stored", source: "journal_brain", trust_tier: "AGENT_INFERRED", admission: null },
      { ...row, memory_id: "admitted", source: "belief_harvester", trust_tier: null, admission: { extractionMethod: "llm_extract" } },
      { ...row, memory_id: "control", source: "journal_brain", trust_tier: null, admission: null },
    ];
    const r = await recallMemoriesForQuery("tire supplier invoice", {
      embedding: Array.from({ length: 1024 }, () => 0.01),
      sideEffects: false,
    });
    const tier = (id: string) => r.hits.find((x) => x.memoryId === id)?.trustTier;
    expect(tier("control")).toBe("SYSTEM_DERIVED");
    expect(tier("stored")).toBe("AGENT_INFERRED");
    expect(tier("admitted")).toBe("AGENT_INFERRED");
    const main = h.sql.find((s) => s.sql.includes("LIMIT") && s.sql.includes("ve.embedding_vec_1536 <=>") && !s.sql.includes("durable"))!;
    expect(main.sql).toContain("trust_tier");
    expect(main.sql).toContain("admission");
  });
});

describe("Private Lab · contextual recall reads without writing", () => {
  it("a private turn recalls and makes zero writes", async () => {
    const out = await withTurnContext({ privateMode: true }, () => runContextual());
    await flush();
    expect(out).toContain("Context-Matched Memories");
    expect(recallWrites()).toEqual([]);
    expect(h.exec.filter((e) => !/^\s*SET LOCAL/.test(e.sql))).toEqual([]);
  });

  it("sideEffects:false is honoured outside a turn scope too", async () => {
    await getContextualMemories(["what did the tire supplier say about the invoice"], 5, {
      fastTopics: true,
      queryEmbedding: EMBED,
      sideEffects: false,
    });
    await flush();
    expect(recallWrites()).toEqual([]);
    expect(h.exec.filter((e) => !/^\s*SET LOCAL/.test(e.sql))).toEqual([]);
  });

  it("CONTROL · a normal turn does write the recall bump", async () => {
    await withTurnContext({}, () => runContextual());
    await flush();
    expect(h.exec.some((e) => /UPDATE brain_memories/.test(e.sql))).toBe(true);
  });
});

describe("M8 · KNN never mixes embedding spaces", () => {
  it("embeddingSpaceSql keeps unknown + same-space rows and drops recorded foreign spaces", () => {
    const s = embeddingSpaceSql("ve.model", "cohere:embed-v4.0");
    expect(s).toContain("ve.model IS NULL");
    expect(s).toContain("'cohere:embed-v4.0'");
    expect(s).toContain("'cohere-embed-v4.0'");
    // a foreign legacy identity is in the "recorded identity" list, not the same-space list
    const same = s.match(/= ANY\(ARRAY\[([^\]]*)\]/)![1];
    expect(same).not.toContain("venice-bge-m3");
    expect(s).toContain("'venice-bge-m3'");
  });

  it("rejects an unsafe model id instead of interpolating it", () => {
    expect(() => embeddingSpaceSql("model", "x'; DROP TABLE y; --")).toThrow(/unsafe embedding model id/);
  });

  it("knnSearch, the contextual KNN pool and both hybrid KNN lanes carry the filter", async () => {
    bustPgvectorCache();
    await knnSearch([0.1, 0.2, 0.3], { sourceType: "brain_memory" });
    const k = h.sql.find((s) => s.sql.includes("embedding_vec <=>"))!;
    expect(k.sql).toContain(embeddingSpaceSql("model"));

    h.sql.length = 0;
    await runContextual();
    const pool = h.sql.find((s) => s.sql.includes("FROM vector_embeddings ve") && s.sql.includes("LIMIT"))!;
    expect(pool.sql).toContain(embeddingSpaceSql("ve.model"));

    h.sql.length = 0;
    await recallMemoriesForQuery("x", { embedding: Array.from({ length: 1024 }, () => 0.01), sideEffects: false });
    const dense = h.sql.filter((s) => s.sql.includes("vector_embeddings ve"));
    expect(dense.length).toBe(2);
    for (const d of dense) expect(d.sql).toContain(embeddingSpaceSql("ve.model"));
  });
});

describe("M5 · decay is guarded (NOT wired: data-cleanup reports a dry-run count, see data-cleanup-decay-dry-run.test.ts)", () => {
  it("runMemoryDecay runs one guarded UPDATE that never touches updated_at", async () => {
    const n = await runMemoryDecay();
    expect(n).toBe(3);
    const u = h.exec.find((e) => /UPDATE brain_memories/.test(e.sql))!;
    expect(u.sql).toContain("expires_at IS NULL");
    expect(u.sql).toContain("deleted_at IS NULL");
    expect(u.sql).toMatch(/category <> ALL\(\$2::text\[\]\)/);
    expect(u.params[1]).toEqual(expect.arrayContaining([...NEVER_HARD_DELETE_CATEGORIES, "pinned_user"]));
    expect(u.sql).toMatch(/created_by.*'user'/);
    expect(u.sql).toMatch(/source.*'manual'/);
    expect(u.sql).not.toContain("updated_at");
  });

  it("the dry-run count and the UPDATE share ONE where-clause and ONE parameter list", async () => {
    const { countMemoryDecayCandidates } = await import("@/lib/brain/memory-decay");
    const n = await countMemoryDecayCandidates();
    expect(n).toBe(7);
    await runMemoryDecay();

    const count = h.sql.find((s) => /SELECT COUNT\(\*\)/i.test(s.sql) && s.sql.includes("FROM brain_memories"))!;
    const update = h.exec.find((e) => /UPDATE brain_memories/.test(e.sql))!;
    const whereOf = (sql: string) => sql.slice(sql.indexOf("WHERE")).replace(/\s+/g, " ").trim();
    expect(whereOf(count.sql)).toBe(whereOf(update.sql));
    // $1 is "now minus 30 days" computed per call, so two calls differ by a few ms:
    // same exempt list, cutoffs within a second.
    const sameParams = (a: unknown[], b: unknown[]) => {
      expect(Math.abs((a[0] as Date).getTime() - (b[0] as Date).getTime())).toBeLessThan(1000);
      expect(a[1]).toEqual(b[1]);
      expect(a).toHaveLength(2);
    };
    sameParams(count.params, update.params);
    expect(h.exec.filter((e) => /brain_memories/.test(e.sql)), "counting wrote nothing").toHaveLength(1);
  });
});
