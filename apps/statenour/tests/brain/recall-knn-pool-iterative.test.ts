/**
 * The dense KNN pool must run as a FILTERED iterative scan (2026-09-22).
 *
 * Measured read-only on prod (pgvector 0.8.0, hnsw.ef_search default 40): for
 * six real memory-shaped queries the raw nearest-40 candidates were 45% dead
 * (34 pointed at hard-deleted memories, 64 at soft-deleted ones), so after
 * getKnnPoolRows' join on live memories the 50-slot pool came back with 9-28
 * rows. HNSW returns its candidate budget FIRST and the WHERE filters after —
 * and LIMIT 50 can never be met with ef_search 40 even on a clean index. With
 * `SET LOCAL hnsw.iterative_scan = relaxed_order` every pool filled to 50/50
 * in 280-600 ms (faster than a raised ef_search, because the scan stops once
 * 50 rows pass the filter). The dead vectors stay where they are: lib/db/
 * embedding-cleanup.ts keeps them on purpose, their text column being the
 * last copy of a hard-deleted memory 100% of the time in the 08-16 sample, so
 * the fix belongs at query time.
 *
 * Source contract on the pool block, comment-stripped: the SET LOCAL and the
 * query travel in ONE transaction (SET LOCAL is transaction-scoped and the
 * pool runs on pooled connections), the scan skips vectors whose source is
 * already marked unavailable, excludes the recall-quarantined categories, is
 * bounded by a timeout, and keeps its LIMIT.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../../lib/brain/contextual-recall.ts", import.meta.url), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const start = SRC.indexOf("async function getKnnPoolRows(");
const end = SRC.indexOf("\n// ----", start);
const POOL = stripComments(SRC.slice(start, end > 0 ? end : undefined));

describe("getKnnPoolRows · filtered iterative scan", () => {
  it("POSITIVE CONTROL: the block was found and still runs the KNN over embedding_vec_1536", () => {
    expect(start).toBeGreaterThan(0);
    expect(POOL).toContain("ORDER BY ve.embedding_vec_1536 <=>");
    expect(POOL).toContain("LIMIT ${limit}");
  });

  it("sets hnsw.iterative_scan = relaxed_order with SET LOCAL inside the same transaction as the query", () => {
    expect(POOL).toContain("SET LOCAL hnsw.iterative_scan = relaxed_order");
    expect(POOL).toContain("$transaction(");
    expect(POOL).toMatch(/tx\.\$executeRawUnsafe\(\s*["'`]SET LOCAL hnsw\.iterative_scan/);
    expect(POOL).toMatch(/tx\.\$queryRawUnsafe</);
  });

  it("skips vectors whose source is already marked unavailable and the recall-quarantined categories", () => {
    expect(POOL).toContain('ve."sourceUnavailableAt" IS NULL');
    expect(POOL).toMatch(/bm\.category <> ALL\(/);
    expect(POOL).toContain("RECALL_EXCLUDE_CATEGORIES");
  });

  it("bounds the transaction so a cold pool cannot hang a turn (the lane is best-effort and returns [] on failure)", () => {
    expect(POOL).toMatch(/timeout:\s*KNN_POOL_TIMEOUT_MS/);
    expect(SRC).toMatch(/const KNN_POOL_TIMEOUT_MS\s*=\s*\d[\d_]*/);
  });
});
