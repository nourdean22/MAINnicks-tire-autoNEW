/**
 * LANE-FAILURE PROVENANCE -- 2026-09-10.
 *
 * Review #2267 P2, and the reviewer was right.
 *
 * The provenance work replaced "hits: [] means nothing matched" with a
 * three-state answer -- and then recreated the identical defect one
 * level down. Each retrieval lane catches its own error and returns [],
 * which is correct for resilience: one dead lane must not take the turn
 * down. But the provenance mapper inferred ZERO from `scored.length`, so
 * during a Postgres or pgvector outage the panel would have said
 * "searched memory, nothing matched" when nothing was searched at all.
 *
 * That is the exact inversion the whole change exists to remove, which
 * is why it needs a test rather than a comment.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbDown = () => Promise.reject(new Error("db down"));

// Every lane routes through one of these. Rejecting all three is the
// total-outage case; the surviving-lane case is covered below.
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

import { recallMemoriesForQuery, describeRecallState } from "@/lib/brain/memory-recall";

// A real-length vector so the padding + finiteness guards pass and the
// lanes are actually reached.
const EMBEDDING = Array.from({ length: 1536 }, () => 0.01);

beforeEach(() => {
  queryRawUnsafe.mockClear();
  queryRawUnsafe.mockImplementation(dbDown);
});

describe("a total retrieval outage is ERROR, never a measured ZERO", () => {
  it("reports ERROR when every lane fails", async () => {
    const report = await recallMemoriesForQuery("what did I decide about the taper plan", {
      embedding: EMBEDDING,
      limit: 5,
    });
    expect(report.hits).toHaveLength(0);
    // The whole point: empty hits, but NOT a measured zero.
    expect(report.provenance).toBe("ERROR");
    expect(report.provenanceReason).toMatch(/every retrieval lane failed/i);
  });

  it("the operator-facing line says the state is unknown, not empty", () => {
    const view = describeRecallState(0, "ERROR", "every retrieval lane failed (main, durable, lexical)");
    expect(view.countIsMeaningful).toBe(false);
    expect(view.headline).toMatch(/not empty/i);
    expect(view.headline).not.toMatch(/\b0\b/);
  });
});

describe("a partial outage still serves results, and says so", () => {
  it("surviving lanes produce hits, with the failure named in the reason", async () => {
    // Only the lexical lane answers; the vector lanes are dead.
    queryRawUnsafe.mockImplementation((sql: unknown) => {
      if (typeof sql === "string" && sql.includes("websearch_to_tsquery")) {
        return Promise.resolve([
          {
            memory_id: "m1",
            category: "preferences",
            key: "k",
            content: "the taper plan starts monday",
            confidence: 0.8,
            seen_count: 1,
            last_seen: new Date(),
            created_at: new Date(),
            distance: 0.2,
            source: "manual",
            created_by: "user",
          },
        ]);
      }
      return dbDown();
    });

    const report = await recallMemoriesForQuery("the taper plan", {
      embedding: EMBEDDING,
      limit: 5,
    });

    expect(report.hits.length).toBeGreaterThan(0);
    // Hits exist, so this is OK -- but the degradation must be visible,
    // or a chronically dead vector lane hides behind the lexical one
    // forever. Recovery that conceals failure is concealment.
    expect(report.provenance).toBe("OK");
    expect(report.provenanceReason).toMatch(/lane\(s\) failed/i);
  });
});

/**
 * SELF-REVIEW REGRESSIONS -- 2026-09-10.
 *
 * Both of these were found by re-reading the diff, not by a failing
 * test, which is the point: the first version of the ledger had no
 * coverage for "some lanes died AND the survivors matched nothing", and
 * that gap is exactly where it was wrong.
 */
describe("a partial outage with no hits is ERROR, not a measured ZERO", () => {
  it("some lanes dead + survivors match nothing => ERROR", async () => {
    // Lexical answers, but with zero rows. Vector lanes are dead.
    queryRawUnsafe.mockImplementation((sql: unknown) => {
      if (typeof sql === "string" && sql.includes("websearch_to_tsquery")) {
        return Promise.resolve([]);
      }
      return dbDown();
    });

    const report = await recallMemoriesForQuery("something never discussed", {
      embedding: EMBEDDING,
      limit: 5,
    });

    expect(report.hits).toHaveLength(0);
    // The bug: this returned "ZERO" while its own reason string called
    // it a partial outage. A zero is trustworthy only if every lane ran.
    expect(report.provenance).toBe("ERROR");
    expect(report.provenanceReason).toMatch(/partial outage, not a measured empty/i);
  });

  // CONTROL: with every lane healthy and nothing matching, the zero is
  // real and must be reported as such -- otherwise the fix above turns
  // every genuine no-match into a scary "read failed".
  it("CONTROL - all lanes healthy + nothing matched => a true ZERO", async () => {
    queryRawUnsafe.mockImplementation(() => Promise.resolve([]));
    const report = await recallMemoriesForQuery("something never discussed", {
      embedding: EMBEDDING,
      limit: 5,
    });
    expect(report.provenance).toBe("ZERO");
    expect(report.provenanceReason).toBeUndefined();
  });
});

describe("the embedding-outage path reports the lexical lane honestly", () => {
  it("embedding gone AND lexical dead => says nothing was searched", async () => {
    // The original omitted the failure sink here, so this case reported
    // "lexical retrieval matched nothing" -- a measured zero for a lane
    // that had thrown.
    queryRawUnsafe.mockImplementation(dbDown);
    const report = await recallMemoriesForQuery("the taper plan", { embedding: [], limit: 5 });
    expect(report.provenance).toBe("ERROR");
    expect(report.provenanceReason).toMatch(/lexical lane failed/i);
    expect(report.provenanceReason).toMatch(/nothing was searched/i);
  });

  it("CONTROL - embedding gone but lexical RAN and matched nothing says so", async () => {
    queryRawUnsafe.mockImplementation(() => Promise.resolve([]));
    const report = await recallMemoriesForQuery("the taper plan", { embedding: [], limit: 5 });
    expect(report.provenance).toBe("ERROR"); // dense lanes still did not run
    expect(report.provenanceReason).toMatch(/ran and matched nothing/i);
  });
});

describe("the lexical lane honours the CONTEXT_CATEGORIES anti-list", () => {
  /**
   * Review finding, 2026-09-10. The first version of the lexical lane
   * had no category predicate. Every other lane in this file excludes
   * telemetry / marker / alert rows -- the main lane post-filters on
   * CONTEXT_CATEGORIES, the durable lane restricts in SQL. Skipping it
   * is WORSE for lexical than for dense: lexical needs only literal
   * token overlap, so "what happened at 3am" reaches an alert row
   * reading "High CPU at 3am".
   *
   * The original justification cited a measured hit@5 = 0/28, but that
   * finding was about DURABLE_PERSONAL_CATEGORIES losing personal facts
   * inside a fixed KNN window -- a different filter solving a different
   * problem.
   */
  it("passes the category allow-list to the query as a bound parameter", async () => {
    let lexicalParams: unknown[] = [];
    queryRawUnsafe.mockImplementation((sql: unknown, ...params: unknown[]) => {
      if (typeof sql === "string" && sql.includes("websearch_to_tsquery")) {
        lexicalParams = params;
        expect(sql).toMatch(/bm\.category = ANY\(\$2\)/);
      }
      return Promise.resolve([]);
    });

    await recallMemoriesForQuery("what happened at 3am", { embedding: EMBEDDING, limit: 5 });

    // $2 is the allow-list, bound (not interpolated).
    expect(Array.isArray(lexicalParams[1])).toBe(true);
    const cats = lexicalParams[1] as string[];
    expect(cats.length).toBeGreaterThan(0);
    // CONTROL: the list must still carry real conversational categories,
    // or the "filter" is just switching the lane off -- which would pass
    // the anti-list assertion above while deleting the feature.
    expect(cats).toContain("preference");
    expect(cats).toContain("decision_log");
    // And the anti-list members must be absent. This is the invariant
    // the finding was actually about: lexical needs only literal token
    // overlap, so "what happened at 3am" would otherwise reach an alert
    // row reading "High CPU at 3am".
    expect(cats).not.toContain("telemetry");
    expect(cats).not.toContain("alert");
    expect(cats).not.toContain("marker");
    // gmail_thread is inbound third-party mail -- fenced elsewhere, and
    // it must not be a lexical recall target either.
    expect(cats).not.toContain("gmail_thread");
  });
});

/** Drop `-- ...` line comments so assertions read SQL, not prose. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

describe("the lexical lane ranks on weight + cover density, filters on the index", () => {
  /**
   * The index (brain_memories_content_fts_idx, 2026-06-02) is built on
   * the UNWEIGHTED `to_tsvector('english', content)`. Putting weights in
   * the WHERE clause would stop matching it and turn every recall into a
   * seq scan -- a silent, permanent performance regression that no test
   * would otherwise notice. So the invariant is: filter unweighted, rank
   * weighted.
   */
  it("keeps the WHERE predicate in the indexed form", async () => {
    let lexicalSql = "";
    queryRawUnsafe.mockImplementation((sql: unknown) => {
      if (typeof sql === "string" && sql.includes("websearch_to_tsquery")) lexicalSql = sql;
      return Promise.resolve([]);
    });
    await recallMemoriesForQuery("the taper plan", { embedding: EMBEDDING, limit: 5 });

    // Strip `-- ...` comments first: the rationale comment above the
    // WHERE clause mentions setweight, and slicing raw SQL would match
    // the prose instead of the predicate.
    const sql = stripSqlComments(lexicalSql);
    const where = sql.slice(sql.indexOf("WHERE"), sql.indexOf("ORDER BY"));
    expect(where).toMatch(/bm\.content_tsv @@ websearch_to_tsquery/);
    // The regression this guards: weights creeping into the filter.
    expect(where).not.toMatch(/setweight/);
  });

  it("ranks with cover density over weighted key + content", async () => {
    let lexicalSql = "";
    queryRawUnsafe.mockImplementation((sql: unknown) => {
      if (typeof sql === "string" && sql.includes("websearch_to_tsquery")) lexicalSql = sql;
      return Promise.resolve([]);
    });
    await recallMemoriesForQuery("the taper plan", { embedding: EMBEDDING, limit: 5 });

    const order = stripSqlComments(lexicalSql).slice(stripSqlComments(lexicalSql).indexOf("ORDER BY"));
    // Cover density: multi-word queries should reward proximity.
    expect(order).toMatch(/ts_rank_cd/);
    // A hit on the memory's KEY outranks one in the body.
    expect(order).toMatch(/setweight\(to_tsvector\('english', coalesce\(bm\.key/);
    expect(order).toMatch(/'A'/);
    expect(order).toMatch(/'B'/);
    // CONTROL: plain ts_rank must be gone, or the upgrade did not land.
    expect(order).not.toMatch(/ts_rank\(/);
  });
});
