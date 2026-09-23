/**
 * scripts/drain-edge-vectors.ts must be a dry run unless told otherwise
 * (2026-09-22).
 *
 * prod-db-guard: a `--dry-run` flag is not a guard until a non-executing read
 * proves the script returns before the write. This pins that property on the
 * source, comment-stripped: the only DELETE targets semantic_edge vectors, it
 * sits AFTER the dry-run early return, and that return is taken whenever
 * `--apply` is absent. A drain that deleted anything else, or deleted before
 * printing its host and count, would fail here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../../scripts/drain-edge-vectors.ts", import.meta.url), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("drain-edge-vectors · dry run by default", () => {
  it("POSITIVE CONTROL: the script exists, parses --apply, and contains exactly one DELETE", () => {
    expect(CODE).toMatch(/const APPLY = process\.argv\.includes\("--apply"\)/);
    expect(CODE.match(/DELETE FROM vector_embeddings/g)?.length).toBe(1);
  });

  it("the DELETE is unreachable without --apply: the dry-run return comes first", () => {
    const dryReturn = CODE.indexOf("if (!APPLY) {");
    const del = CODE.indexOf("DELETE FROM vector_embeddings");
    expect(dryReturn).toBeGreaterThan(0);
    expect(del).toBeGreaterThan(dryReturn);
    // the dry-run branch RETURNS before the DELETE is reached, it does not merely log
    const between = CODE.slice(dryReturn, del);
    expect(between).toMatch(/\breturn;/);
  });

  it("targets semantic_edge vectors only, and never the brain_memories rows", () => {
    expect(CODE).toContain("bm.category = 'semantic_edge'");
    expect(CODE).not.toMatch(/DELETE FROM brain_memories/);
    expect(CODE).not.toMatch(/deleted_at IS NOT NULL/); // the dead-memory vectors are not this script's business
  });

  it("prints the database host and counts before any write, and bounds each batch", () => {
    const host = CODE.indexOf("database host:");
    const count = CODE.indexOf("semantic_edge vectors:");
    const del = CODE.indexOf("DELETE FROM vector_embeddings");
    expect(host).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(host);
    expect(del).toBeGreaterThan(count);
    expect(CODE).toMatch(/LIMIT \$\{BATCH\}/);
    expect(CODE).toMatch(/if \(n === 0\) break;/);
  });
});

describe("drain-edge-vectors · an --apply run backs up first (2026-09-23)", () => {
  const dryReturn = CODE.indexOf("if (!APPLY) {");
  const backup = CODE.indexOf("CREATE TABLE ${BACKUP_TABLE} AS SELECT ve.* ${EDGE_VECTOR_MATCH}");
  const del = CODE.indexOf("DELETE FROM vector_embeddings");

  it("the backup copy of exactly the predicate's rows sits after the dry-run return and before the DELETE", () => {
    expect(backup).toBeGreaterThan(dryReturn);
    expect(del).toBeGreaterThan(backup);
  });

  it("a count mismatch between the backup and the pre-count RETURNS before the DELETE", () => {
    const check = CODE.indexOf("if (backedUp !== edgeVectors) {");
    expect(check).toBeGreaterThan(backup);
    expect(check).toBeLessThan(del);
    expect(CODE.slice(check, del)).toMatch(/\breturn;/);
  });

  it("refuses an existing backup table rather than appending to it, and validates the table name", () => {
    const exists = CODE.indexOf("refusing: backup table ${BACKUP_TABLE} already exists");
    expect(exists).toBeGreaterThan(dryReturn);
    expect(exists).toBeLessThan(backup);
    // the validator must accept its OWN default name - the first apply run refused
    // _bak_vector_embeddings_edge_drain_20260922 because the pattern demanded a letter
    // where the house pattern puts an underscore.
    const validator = /^[a-z_][a-z0-9_]{0,62}$/;
    expect(CODE).toContain(validator.source);
    expect("_bak_vector_embeddings_edge_drain_20260923").toMatch(validator);
  });

  it("prints the restore route before deleting", () => {
    const restore = CODE.indexOf("restore route: INSERT INTO vector_embeddings SELECT * FROM ${BACKUP_TABLE}");
    expect(restore).toBeGreaterThan(backup);
    expect(restore).toBeLessThan(del);
  });
});
