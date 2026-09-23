/**
 * scripts/reindex-vector-index.ts must be a dry run unless told otherwise
 * (2026-09-23, after the 64% semantic_edge drain left HNSW tombstones).
 *
 * prod-db-guard, same shape as the drain's own test: pinned on the source,
 * comment-stripped. The only REINDEX is CONCURRENTLY, on ONE named index, it
 * sits AFTER the dry-run early return, and it is refused unless the name is
 * an existing hnsw index on vector_embeddings. A script that could REINDEX a
 * btree, a table, or an unnamed target would fail here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../../scripts/reindex-vector-index.ts", import.meta.url), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("reindex-vector-index · dry run by default", () => {
  it("POSITIVE CONTROL: parses --apply and --index, and contains exactly one REINDEX, CONCURRENTLY", () => {
    expect(CODE).toMatch(/const APPLY = process\.argv\.includes\("--apply"\)/);
    expect(CODE).toMatch(/--index=/);
    // the STATEMENT, not the mode banner that names it: exactly one executeRaw carries a REINDEX
    expect(CODE.match(/executeRawUnsafe\(`REINDEX/g)?.length).toBe(1);
    expect(CODE).toContain("$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY ${INDEX}`)");
  });

  it("the REINDEX is unreachable without --apply: the dry-run return comes first, after the listing", () => {
    const listing = CODE.indexOf("database host:");
    const dryReturn = CODE.indexOf("if (!APPLY) return;");
    const reindex = CODE.indexOf("$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY");
    expect(listing).toBeGreaterThan(0);
    expect(dryReturn).toBeGreaterThan(listing);
    expect(reindex).toBeGreaterThan(dryReturn);
  });

  it("refuses a name that is not an existing hnsw index on vector_embeddings, and validates the name shape", () => {
    const reindex = CODE.indexOf("$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY");
    const notOnTable = CODE.indexOf("is not an index on vector_embeddings");
    const notHnsw = CODE.indexOf("is not an hnsw index");
    expect(notOnTable).toBeGreaterThan(0);
    expect(notHnsw).toBeGreaterThan(notOnTable);
    expect(reindex).toBeGreaterThan(notHnsw);
    const validator = /^[a-z_][a-z0-9_]{0,62}$/;
    expect(CODE).toContain(validator.source);
    expect("vector_embeddings_embedding_vec_1536_hnsw").toMatch(validator);
  });

  it("reports leftover invalid or _ccnew indexes instead of calling a failed rebuild done", () => {
    expect(CODE).toMatch(/_ccnew/);
    expect(CODE).toMatch(/leftover invalid or _ccnew indexes/);
  });
});
