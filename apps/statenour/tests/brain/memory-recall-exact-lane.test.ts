/**
 * EXACT-IDENTIFIER LANE -- 2026-09-15.
 *
 * `planQuery()` extracted `exactTerms` (BDN-310, #2196, snake_case symbols,
 * file paths) on every chat turn, brain-context.ts logged them, and nothing
 * queried them: a dark wire. Neither dense lane can find an id (no
 * embedding neighbourhood) and the tsvector lane tokenises hyphens and
 * hashes away, so the one thing the operator typed verbatim was the one
 * thing recall was structurally blind to.
 *
 * Three things are pinned here:
 *   1. the four-lane fusion is BACKWARD COMPATIBLE -- an empty exact lane
 *      changes nothing for every three-lane caller and canary;
 *   2. `likePattern` escapes LIKE metacharacters, so a snake_case symbol
 *      (`_` is a single-char wildcard) cannot match by accident;
 *   3. the lane is conditional and the provenance ledger knows it: the
 *      "every lane failed" verdict counts the lanes that RAN, so a
 *      surviving exact lane is not reported as a total outage and four
 *      dead lanes are not reported as a partial one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbDown = () => Promise.reject(new Error("db down"));
const queryRawUnsafe = vi.fn(dbDown);
const transaction = vi.fn((fn: (tx: unknown) => unknown) =>
  Promise.resolve(fn({ $queryRawUnsafe: queryRawUnsafe, $executeRawUnsafe: async () => 0 })),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...a),
    $executeRawUnsafe: async () => 0,
    $transaction: (fn: (tx: unknown) => unknown) => transaction(fn),
    brainMemory: { updateMany: async () => ({ count: 0 }), findMany: async () => [] },
    systemMetric: { create: async () => ({}) },
  },
}));
vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: false }) }));

import {
  likePattern,
  recallMemoriesForQuery,
  rrfMergeHitOrders,
  type RecallHit,
} from "@/lib/brain/memory-recall";

const EMBEDDING = Array.from({ length: 1536 }, () => 0.01);
const isExactSql = (sql: unknown) => typeof sql === "string" && sql.includes("ILIKE ANY($1)");

function hit(id: string, score = 1): RecallHit {
  return {
    memoryId: id,
    category: "fact",
    key: `k:${id}`,
    content: `content ${id}`,
    confidence: 0.8,
    seenCount: 1,
    ageDays: 1,
    factAgeDays: 1,
    knnDistance: 1 - score,
    finalScore: score,
  } as RecallHit;
}

function row(memory_id: string) {
  return {
    memory_id,
    category: "preferences",
    key: "ticket",
    content: `BDN-310 is the taper ticket`,
    confidence: 0.8,
    seen_count: 1,
    last_seen: new Date(),
    created_at: new Date(),
    distance: 0,
    source: "manual",
    created_by: "user",
  };
}

beforeEach(() => {
  queryRawUnsafe.mockClear();
  queryRawUnsafe.mockImplementation(dbDown);
});

describe("four-lane fusion", () => {
  it("CONTROL - an empty exact lane leaves the three-lane result untouched", () => {
    const main = [hit("a"), hit("b"), hit("c")];
    const durable = [hit("d")];
    const lexical = [hit("b"), hit("e")];
    const three = rrfMergeHitOrders(main, durable, lexical);
    const four = rrfMergeHitOrders(main, durable, lexical, []);
    expect(four.map((h) => h.memoryId)).toEqual(three.map((h) => h.memoryId));
  });

  it("CONTROL - all optional lanes empty returns the main ordering by identity", () => {
    const main = [hit("a"), hit("b")];
    expect(rrfMergeHitOrders(main, [], [], [])).toBe(main);
  });

  it("surfaces an exact-only hit that no other lane returned", () => {
    const fused = rrfMergeHitOrders([hit("dense1"), hit("dense2")], [], [], [hit("BDN-310")]);
    expect(fused.map((h) => h.memoryId)).toContain("BDN-310");
  });

  it("a row found by dense AND exact outranks one found by only one lane", () => {
    const fused = rrfMergeHitOrders([hit("only-dense"), hit("both")], [], [], [hit("both"), hit("only-exact")]);
    const rank = (id: string) => fused.findIndex((h) => h.memoryId === id);
    expect(rank("both")).toBeLessThan(rank("only-dense"));
    expect(rank("both")).toBeLessThan(rank("only-exact"));
  });
});

describe("likePattern", () => {
  it("wraps the term in wildcards", () => {
    expect(likePattern("BDN-310")).toBe("%BDN-310%");
  });

  it("escapes LIKE metacharacters so snake_case and percent are literal", () => {
    // `_` is a one-character wildcard: unescaped, "taper_plan" would also
    // match "taperXplan". The planner emits snake_case symbols routinely.
    expect(likePattern("taper_plan")).toBe("%taper\\_plan%");
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a\\b")).toBe("%a\\\\b%");
  });
});

describe("the lane is conditional, and the provenance ledger counts what ran", () => {
  it("CONTROL - with no exact terms, no ILIKE query is ever issued", async () => {
    queryRawUnsafe.mockImplementation(() => Promise.resolve([]));
    await recallMemoriesForQuery("what did I decide about the taper plan", {
      embedding: EMBEDDING,
      limit: 5,
    });
    const sqls = queryRawUnsafe.mock.calls.map((c) => c[0]);
    expect(sqls.length).toBeGreaterThan(0);
    expect(sqls.some(isExactSql)).toBe(false);
  });

  it("with exact terms, the ILIKE lane runs with escaped %term% patterns", async () => {
    queryRawUnsafe.mockImplementation(() => Promise.resolve([]));
    await recallMemoriesForQuery("status of BDN-310 and taper_plan", {
      embedding: EMBEDDING,
      limit: 5,
      exactTerms: ["BDN-310", "taper_plan"],
    });
    const exactCall = queryRawUnsafe.mock.calls.find((c) => isExactSql(c[0]));
    expect(exactCall).toBeDefined();
    expect(exactCall?.[1]).toEqual(["%BDN-310%", "%taper\\_plan%"]);
  });

  it("an exact hit survives a dead vector+lexical stack, and the reason names a PARTIAL outage", async () => {
    queryRawUnsafe.mockImplementation((sql: unknown) => (isExactSql(sql) ? Promise.resolve([row("m-exact")]) : dbDown()));
    const report = await recallMemoriesForQuery("what happened with BDN-310", {
      embedding: EMBEDDING,
      limit: 5,
      exactTerms: ["BDN-310"],
    });
    expect(report.hits.map((h) => h.memoryId)).toEqual(["m-exact"]);
    expect(report.provenance).toBe("OK");
    // Three of four lanes died. A fixed lane count of 3 would call this
    // "every retrieval lane failed" while returning a hit.
    expect(report.provenanceReason).toMatch(/lane\(s\) failed; results are from the surviving/i);
    expect(report.provenanceReason).not.toMatch(/every retrieval lane failed/i);
  });

  it("all four lanes dead is ERROR with 'every retrieval lane failed', naming the exact lane", async () => {
    const report = await recallMemoriesForQuery("what happened with BDN-310", {
      embedding: EMBEDDING,
      limit: 5,
      exactTerms: ["BDN-310"],
    });
    expect(report.hits).toHaveLength(0);
    expect(report.provenance).toBe("ERROR");
    expect(report.provenanceReason).toMatch(/every retrieval lane failed/i);
    expect(report.provenanceReason).toMatch(/exact/);
  });

  it("a slow exact lane is bounded and does not sink the surviving lanes", async () => {
    // A leading-wildcard ILIKE cannot use an index. The chat path races the
    // whole recall against 3s, so an unbounded exact lane would time out
    // ALL four lanes together. Here the ILIKE never resolves; the lexical
    // lane answers; the report must carry the lexical hit and name the
    // exact lane as the one that failed.
    vi.useFakeTimers();
    try {
      queryRawUnsafe.mockImplementation((sql: unknown) => {
        if (isExactSql(sql)) return new Promise(() => undefined); // hangs forever
        if (typeof sql === "string" && sql.includes("websearch_to_tsquery")) return Promise.resolve([row("m-lex")]);
        return dbDown();
      });
      const pending = recallMemoriesForQuery("what happened with BDN-310", {
        embedding: EMBEDDING,
        limit: 5,
        exactTerms: ["BDN-310"],
      });
      await vi.advanceTimersByTimeAsync(1_600); // EXACT_LANE_TIMEOUT_MS (1500) + slack
      const report = await pending;
      expect(queryRawUnsafe.mock.calls.some((c) => isExactSql(c[0]))).toBe(true);
      expect(report.hits.map((h) => h.memoryId)).toEqual(["m-lex"]);
      expect(report.provenance).toBe("OK");
      expect(report.provenanceReason).toMatch(/exact/);
      expect(report.provenanceReason).toMatch(/lane\(s\) failed; results are from the surviving/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("CONTROL - three lanes dead with no exact terms is still a TOTAL outage", async () => {
    const report = await recallMemoriesForQuery("what did I decide about the taper plan", {
      embedding: EMBEDDING,
      limit: 5,
    });
    expect(report.provenance).toBe("ERROR");
    expect(report.provenanceReason).toMatch(/every retrieval lane failed/i);
    expect(report.provenanceReason).not.toMatch(/exact/);
  });
});
