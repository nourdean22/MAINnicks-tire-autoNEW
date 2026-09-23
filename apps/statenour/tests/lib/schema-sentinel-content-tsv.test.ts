/**
 * Behavioural canary for the brain_memories.content_tsv GIN expectation (review on #2553).
 *
 * The expectation is matched by DEFINITION (`USING gin (content_tsv)`, matchByDefinition), and the
 * sentinel's checker runs that match server-side (`indexdef ILIKE '%…%'`). So the two states a real
 * database can be in map onto the two responses below:
 *   · an index whose definition contains the pattern → one row comes back → no finding
 *   · no index with that definition - the column is missing, the GIN was dropped, or an index that
 *     merely WEARS the name `brain_memories_content_tsv_idx` is a btree or the old expression index
 *     renamed → zero rows come back → a MEDIUM finding naming the pattern
 * A name-only expectation could not tell the third case from health; this file pins that it stays
 * definition-matched, and that the checker turns "no definition match" into a finding.
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

const TARGET = EXPECTATIONS.findIndex(
  (e) => e.kind === "index_exists" && e.table === "brain_memories" && e.indexName === "USING gin (content_tsv)",
);

function healthyRow(e: (typeof EXPECTATIONS)[number]): unknown[] {
  if (e.kind === "column_exists") return [{ column_name: e.column, is_nullable: e.nullable === false ? "NO" : "YES", data_type: "text" }];
  if (e.kind === "index_exists") return [{ indexname: e.indexName, indexdef: `CREATE INDEX ${e.indexName} ON ...` }];
  if (e.kind === "partial_unique") return [{ indexname: e.indexName, indexdef: `CREATE UNIQUE INDEX ${e.indexName} ON x(...) WHERE ${e.predicate}` }];
  return []; // regular_unique_absent: empty = absent = healthy
}

function queue(perExpectation: unknown[][]) {
  let i = 0;
  const sequence = [[{ ok: 1 }], ...perExpectation];
  mocks.queryRaw.mockImplementation(() => Promise.resolve(sequence[i++] ?? []));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("brain_memories.content_tsv GIN · matched by definition", () => {
  it("the expectation exists, is definition-matched, and no name-only twin remains", () => {
    expect(TARGET).toBeGreaterThanOrEqual(0);
    const e = EXPECTATIONS[TARGET];
    expect(e.kind === "index_exists" && e.matchByDefinition).toBe(true);
    expect(EXPECTATIONS.some((x) => x.kind === "index_exists" && x.indexName === "brain_memories_content_tsv_idx")).toBe(false);
  });

  it("CONTROL: a GIN whose definition contains `USING gin (content_tsv)` produces no finding", async () => {
    queue(
      EXPECTATIONS.map((e, i) =>
        i === TARGET
          ? [{ indexname: "brain_memories_content_tsv_idx", indexdef: "CREATE INDEX brain_memories_content_tsv_idx ON public.brain_memories USING gin (content_tsv)" }]
          : healthyRow(e),
      ),
    );
    const r = await runSchemaDriftCheck();
    expect(r.reachable).toBe(true);
    expect(r.findings.filter((f) => f.expectation === EXPECTATIONS[TARGET])).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("BREAKS: an index wearing the name but not the definition (old expression index renamed, or a btree) is a MEDIUM finding", async () => {
    // The server-side ILIKE on `USING gin (content_tsv)` matches nothing when the only index named
    // brain_memories_content_tsv_idx is `USING gin (to_tsvector('english'::regconfig, content))` or
    // `USING btree (content_tsv)` - the database returns zero rows for this expectation.
    queue(EXPECTATIONS.map((e, i) => (i === TARGET ? [] : healthyRow(e))));
    const r = await runSchemaDriftCheck();
    expect(r.ok).toBe(false);
    const finding = r.findings.find((f) => f.expectation === EXPECTATIONS[TARGET]);
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("medium");
    expect(finding?.problem).toMatch(/USING gin \(content_tsv\)/);
    // and nothing else drifted - the finding is attributable to this expectation alone
    expect(r.findings).toHaveLength(1);
  });
});
