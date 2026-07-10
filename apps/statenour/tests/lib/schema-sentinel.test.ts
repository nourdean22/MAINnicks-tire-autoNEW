/**
 * Unit tests for lib/db/schema-sentinel.ts
 *
 * v8.1 · Phase 2C · Apr 29 — pin the drift-detection contract:
 *   · column_exists checker (missing → high, nullability mismatch → medium)
 *   · index_exists checker (missing → medium)
 *   · partial_unique checker (missing → high, predicate drift → high)
 *   · regular_unique_absent (resurrected index → high)
 *   · DB-down path returns reachable:false without throwing
 *   · No findings → ok:true
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
  },
}));

import { runSchemaDriftCheck, EXPECTATIONS } from "@/lib/db/schema-sentinel";

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper: queue results for the sentinel's queries in declaration order.
// First call is the connectivity probe (`SELECT 1`), then one per
// expectation. Each "row" must match the shape the checker reads.
function queueResults(connectivity: unknown[], perExpectation: unknown[][]) {
  let i = 0;
  const sequence = [connectivity, ...perExpectation];
  mocks.queryRaw.mockImplementation(() => {
    const result = sequence[i++];
    return Promise.resolve(result ?? []);
  });
}

describe("runSchemaDriftCheck — happy path", () => {
  it("returns ok:true when every expectation is met", async () => {
    // Build a realistic per-expectation response based on each
    // expectation's `kind`.
    const responses = EXPECTATIONS.map((e) => {
      if (e.kind === "column_exists") {
        return [
          {
            column_name: e.column,
            is_nullable: e.nullable === false ? "NO" : "YES",
            data_type: "text",
          },
        ];
      }
      if (e.kind === "index_exists") {
        return [{ indexname: e.indexName, indexdef: `CREATE INDEX ${e.indexName} ON ...` }];
      }
      if (e.kind === "partial_unique") {
        return [
          {
            indexname: e.indexName,
            indexdef: `CREATE UNIQUE INDEX ${e.indexName} ON x(...) WHERE ${e.predicate}`,
          },
        ];
      }
      if (e.kind === "regular_unique_absent") {
        return []; // empty = absent (good)
      }
      return [];
    });

    queueResults([{ ok: 1 }], responses);

    const r = await runSchemaDriftCheck();
    expect(r.reachable).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.expectationCount).toBe(EXPECTATIONS.length);
  });
});

describe("runSchemaDriftCheck — column_exists", () => {
  it("reports HIGH when a required column is missing", async () => {
    // Missing column for the first expectation; pass the rest.
    const responses = EXPECTATIONS.map((e, idx) => {
      if (idx === 0) return []; // missing
      if (e.kind === "column_exists") {
        return [{ column_name: e.column, is_nullable: e.nullable === false ? "NO" : "YES" }];
      }
      if (e.kind === "regular_unique_absent") return [];
      return [{ indexname: e.kind === "partial_unique" ? e.indexName : (e as { indexName?: string }).indexName, indexdef: e.kind === "partial_unique" ? `CREATE UNIQUE INDEX foo WHERE ${e.predicate}` : "CREATE INDEX foo" }];
    });
    queueResults([{ ok: 1 }], responses);

    const r = await runSchemaDriftCheck();
    expect(r.ok).toBe(false);
    expect(r.findings.length).toBeGreaterThan(0);
    const high = r.findings.find((f) => f.severity === "high");
    expect(high).toBeDefined();
    expect(high?.problem).toMatch(/missing/);
  });
});

describe("runSchemaDriftCheck — partial_unique", () => {
  it("flags HIGH when index exists but isn't UNIQUE", async () => {
    const responses = EXPECTATIONS.map((e) => {
      if (e.kind === "partial_unique") {
        // Missing the UNIQUE keyword — uniqueness guarantee gone.
        return [
          {
            indexname: e.indexName,
            indexdef: `CREATE INDEX ${e.indexName} ON x(...) WHERE ${e.predicate}`,
          },
        ];
      }
      if (e.kind === "column_exists") {
        return [{ column_name: e.column, is_nullable: e.nullable === false ? "NO" : "YES" }];
      }
      if (e.kind === "regular_unique_absent") return [];
      return [{ indexname: (e as { indexName?: string }).indexName, indexdef: "CREATE INDEX foo" }];
    });
    queueResults([{ ok: 1 }], responses);

    const r = await runSchemaDriftCheck();
    const partials = r.findings.filter((f) =>
      f.problem.includes("NOT unique") || f.problem.includes("uniqueness guarantee gone"),
    );
    expect(partials.length).toBeGreaterThan(0);
    expect(partials.every((p) => p.severity === "high")).toBe(true);
  });

  it("flags HIGH when partial-unique predicate drifts", async () => {
    const responses = EXPECTATIONS.map((e) => {
      if (e.kind === "partial_unique") {
        return [
          {
            indexname: e.indexName,
            indexdef: `CREATE UNIQUE INDEX ${e.indexName} ON x(...) WHERE 1=1`,
          },
        ];
      }
      if (e.kind === "column_exists") {
        return [{ column_name: e.column, is_nullable: e.nullable === false ? "NO" : "YES" }];
      }
      if (e.kind === "regular_unique_absent") return [];
      return [{ indexname: (e as { indexName?: string }).indexName, indexdef: "CREATE INDEX foo" }];
    });
    queueResults([{ ok: 1 }], responses);

    const r = await runSchemaDriftCheck();
    const drift = r.findings.find((f) => f.problem.includes("predicate drift"));
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe("high");
  });
});

describe("runSchemaDriftCheck — regular_unique_absent", () => {
  it("flags HIGH when a dropped unique has been resurrected by db push", async () => {
    const responses = EXPECTATIONS.map((e) => {
      if (e.kind === "regular_unique_absent") {
        // Index came BACK — drift!
        return [
          {
            indexname: e.indexName,
            indexdef: `CREATE UNIQUE INDEX ${e.indexName} ON ...`,
          },
        ];
      }
      if (e.kind === "column_exists") {
        return [{ column_name: e.column, is_nullable: e.nullable === false ? "NO" : "YES" }];
      }
      if (e.kind === "partial_unique") {
        return [
          {
            indexname: e.indexName,
            indexdef: `CREATE UNIQUE INDEX foo WHERE ${e.predicate}`,
          },
        ];
      }
      return [{ indexname: (e as { indexName?: string }).indexName, indexdef: "CREATE INDEX foo" }];
    });
    queueResults([{ ok: 1 }], responses);

    const r = await runSchemaDriftCheck();
    const resurrected = r.findings.find((f) => f.problem.includes("RESURRECTED"));
    expect(resurrected).toBeDefined();
    expect(resurrected?.severity).toBe("high");
  });
});

describe("runSchemaDriftCheck — connectivity failure", () => {
  it("returns reachable:false without throwing", async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error("connection refused"));

    const r = await runSchemaDriftCheck();
    expect(r.reachable).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings[0].problem).toMatch(/DB connectivity/i);
  });
});

describe("schema-sentinel expectation list", () => {
  it("rejects agent_runs, agent_memory_hits, agent_feedbacks but still includes prompt_versions", () => {
    const tables = EXPECTATIONS.map((e) => e.table);
    expect(tables).not.toContain("agent_runs");
    expect(tables).not.toContain("agent_memory_hits");
    expect(tables).not.toContain("agent_feedbacks");
    expect(tables).toContain("prompt_versions");
  });
});
