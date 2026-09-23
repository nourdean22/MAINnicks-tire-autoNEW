/**
 * Behavioural canaries for the brain_memories.content_tsv expectations (review on #2553).
 *
 * THE GIN, matched by DEFINITION (`USING gin (content_tsv)`, matchByDefinition): the sentinel's checker runs
 * that match server-side (`indexdef ILIKE '%…%'`), so the two states a real database can be in map onto two
 * responses: a row (some index's definition contains the pattern → no finding) or zero rows (the column is
 * missing, the GIN was dropped, or an index that merely WEARS the name is a btree or the old expression index
 * renamed → a MEDIUM finding naming the pattern). A name-only expectation could not tell the third case from health.
 *
 * THE COLUMN, verified as a GENERATED tsvector with exactly the migration's expression: the readers no longer
 * derive the vector from `content`, they trust the column, so an ordinary column (nothing maintains it), a
 * column generated from a different expression (different stemming → different matches) or a column of another
 * type would all read as healthy to a name + nullability check while lexical recall silently rots. Each of those
 * is a HIGH finding; the exact production shape is the control.
 *
 * Same harness as tests/lib/schema-sentinel.test.ts: prisma.$queryRaw is queued in declaration order
 * (connectivity probe first, then one response per expectation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args) },
}));

import { EXPECTATIONS, runSchemaDriftCheck } from "@/lib/db/schema-sentinel";

const GIN = EXPECTATIONS.findIndex(
  (e) => e.kind === "index_exists" && e.table === "brain_memories" && e.indexName === "USING gin (content_tsv)",
);
const COLUMN = EXPECTATIONS.findIndex(
  (e) => e.kind === "column_exists" && e.table === "brain_memories" && e.column === "content_tsv",
);
const PROD_EXPRESSION = "to_tsvector('english'::regconfig, content)";

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

function queue(perExpectation: unknown[][]) {
  let i = 0;
  const sequence = [[{ ok: 1 }], ...perExpectation];
  mocks.queryRaw.mockImplementation(() => Promise.resolve(sequence[i++] ?? []));
}

/** Every expectation healthy except the one at `at`, which answers `rows`. */
function scenario(at: number, rows: unknown[]) {
  queue(EXPECTATIONS.map((e, i) => (i === at ? rows : healthyRow(e))));
}

const prodColumn = {
  column_name: "content_tsv",
  is_nullable: "YES",
  data_type: "tsvector",
  is_generated: "ALWAYS",
  generation_expression: PROD_EXPRESSION,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("brain_memories.content_tsv GIN · matched by definition", () => {
  it("the expectation exists, is definition-matched, and no name-only twin remains", () => {
    expect(GIN).toBeGreaterThanOrEqual(0);
    const e = EXPECTATIONS[GIN];
    expect(e.kind === "index_exists" && e.matchByDefinition).toBe(true);
    expect(EXPECTATIONS.some((x) => x.kind === "index_exists" && x.indexName === "brain_memories_content_tsv_idx")).toBe(false);
  });

  it("CONTROL: a GIN whose definition contains `USING gin (content_tsv)` produces no finding", async () => {
    scenario(GIN, [{ indexname: "brain_memories_content_tsv_idx", indexdef: "CREATE INDEX brain_memories_content_tsv_idx ON public.brain_memories USING gin (content_tsv)" }]);
    const r = await runSchemaDriftCheck();
    expect(r.reachable).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("BREAKS: an index wearing the name but not the definition (old expression index renamed, or a btree) is a MEDIUM finding", async () => {
    // The server-side ILIKE on `USING gin (content_tsv)` matches nothing when the only index named
    // brain_memories_content_tsv_idx is `USING gin (to_tsvector('english'::regconfig, content))` or
    // `USING btree (content_tsv)` - the database returns zero rows for this expectation.
    scenario(GIN, []);
    const r = await runSchemaDriftCheck();
    expect(r.ok).toBe(false);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].expectation).toBe(EXPECTATIONS[GIN]);
    expect(r.findings[0].severity).toBe("medium");
    expect(r.findings[0].problem).toMatch(/USING gin \(content_tsv\)/);
  });
});

describe("brain_memories.content_tsv column · a GENERATED tsvector with the migration's expression", () => {
  it("the expectation pins the type and the exact production generation expression", () => {
    expect(COLUMN).toBeGreaterThanOrEqual(0);
    const e = EXPECTATIONS[COLUMN];
    expect(e.kind === "column_exists" && e.dataType).toBe("tsvector");
    expect(e.kind === "column_exists" && e.generationExpression).toBe(PROD_EXPRESSION);
  });

  it("CONTROL: the production shape (tsvector, GENERATED ALWAYS, the migration's expression) produces no finding", async () => {
    scenario(COLUMN, [prodColumn]);
    const r = await runSchemaDriftCheck();
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("BREAKS: an ORDINARY tsvector column of the same name (nothing maintains it) is a HIGH finding", async () => {
    scenario(COLUMN, [{ ...prodColumn, is_generated: "NEVER", generation_expression: null }]);
    const r = await runSchemaDriftCheck();
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].expectation).toBe(EXPECTATIONS[COLUMN]);
    expect(r.findings[0].severity).toBe("high");
    expect(r.findings[0].problem).toMatch(/not a generated column/);
  });

  it("BREAKS: a column generated from a DIFFERENT expression (other config → other stems → other matches) is a HIGH finding", async () => {
    scenario(COLUMN, [{ ...prodColumn, generation_expression: "to_tsvector('simple'::regconfig, content)" }]);
    const r = await runSchemaDriftCheck();
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe("high");
    expect(r.findings[0].problem).toMatch(/generation expression drift/);
    expect(r.findings[0].problem).toContain(PROD_EXPRESSION);
  });

  it("BREAKS: a column of another type under the same name is a HIGH finding", async () => {
    scenario(COLUMN, [{ ...prodColumn, data_type: "text" }]);
    const r = await runSchemaDriftCheck();
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe("high");
    expect(r.findings[0].problem).toMatch(/type mismatch/);
  });
});
