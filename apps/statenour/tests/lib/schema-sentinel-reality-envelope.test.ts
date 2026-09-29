/**
 * The RealityEvent envelope columns are schema-drift expectations (2026-09-29).
 *
 * #2784 shipped code that uses five new reality_events columns before their migration,
 * 20260929123500_reality_event_envelope, was applied. Every prisma.realityEvent read and write
 * failed from 15:33Z, and GET /api/system/schema-drift reported no drift, because no expectation
 * named those columns.
 *
 * Same harness as tests/lib/schema-sentinel.test.ts: prisma.$queryRaw is queued in declaration
 * order (connectivity probe first, then one response per expectation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args) },
}));

import { EXPECTATIONS, runSchemaDriftCheck } from "@/lib/db/schema-sentinel";

const ENVELOPE_COLUMNS = ["event_version", "occurred_at", "correlation_id", "causation_id", "retention_class"];

const indexOf = (column: string) =>
  EXPECTATIONS.findIndex((e) => e.kind === "column_exists" && e.table === "reality_events" && e.column === column);

function healthyRow(e: (typeof EXPECTATIONS)[number]): unknown[] {
  if (e.kind === "column_exists") {
    return [{
      column_name: e.column,
      is_nullable: e.nullable === false ? "NO" : "YES",
      data_type: e.dataType ?? "text",
      is_generated: e.generationExpression ? "ALWAYS" : "NEVER",
      generation_expression: e.generationExpression ?? null,
    }];
  }
  if (e.kind === "index_exists") return [{ indexname: e.indexName, indexdef: `CREATE INDEX ${e.indexName} ON ...` }];
  if (e.kind === "partial_unique") return [{ indexname: e.indexName, indexdef: `CREATE UNIQUE INDEX ${e.indexName} ON x(...) WHERE ${e.predicate}` }];
  return []; // regular_unique_absent: empty = absent = healthy
}

/** Every expectation healthy except the one at `at`, which answers `rows`. */
function scenario(at: number, rows: unknown[]) {
  let i = 0;
  const sequence = [[{ ok: 1 }], ...EXPECTATIONS.map((e, j) => (j === at ? rows : healthyRow(e)))];
  mocks.queryRaw.mockImplementation(() => Promise.resolve(sequence[i++] ?? []));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reality_events · the RealityEvent envelope columns", () => {
  it("CONTROL: a database with the migration applied shows no drift", async () => {
    scenario(-1, []);
    const r = await runSchemaDriftCheck();
    expect(r.reachable).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it.each(ENVELOPE_COLUMNS)("BREAKS: a database without reality_events.%s is a HIGH finding", async (column) => {
    const at = indexOf(column);
    expect(at, `no schema-drift expectation for reality_events.${column}`).toBeGreaterThanOrEqual(0);
    scenario(at, []);
    const r = await runSchemaDriftCheck();
    expect(r.ok).toBe(false);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe("high");
    expect(r.findings[0].problem).toContain(column);
  });

  it("BREAKS: occurred_at added but still nullable (the migration stopped before SET NOT NULL) is a finding", async () => {
    const at = indexOf("occurred_at");
    expect(at).toBeGreaterThanOrEqual(0);
    scenario(at, [{
      column_name: "occurred_at",
      is_nullable: "YES",
      data_type: "timestamp without time zone",
      is_generated: "NEVER",
      generation_expression: null,
    }]);
    const r = await runSchemaDriftCheck();
    expect(r.ok).toBe(false);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].problem).toMatch(/occurred_at.*nullability mismatch/);
  });
});
