/**
 * brain_memories full-text lane reads the STORED tsvector, never re-parses content
 * (2026-09-22, measured on production before the change).
 *
 * The lexical lane's query was 99% ts_rank: with the GIN expression index in place the
 * production-shaped OR-of-topics query took 1,902 ms warm, and the identical query with
 * the rank removed took 8 ms — Postgres re-ran to_tsvector('english', content) for every
 * one of ~3,600 candidate rows to compute the rank. Under the lane's 900 ms statement
 * timeout that meant the lexical lane was dropped on 84 of 89 hybrid benchmark queries
 * and 36% of sequential production-shaped probes. A stored generated column holds the
 * parsed vector once; the readers rank and filter on it.
 *
 * Source contract, comment-stripped. Every brain_memories full-text reader must use the
 * column, and NONE may still parse content inline — one leftover reader would be a
 * 1.9 s query hiding behind a green suite. The migration's generation expression must be
 * EXACTLY the expression the readers used to parse inline (same config, same input), so
 * the set of matching rows is unchanged: this is a speed change, not a ranking change.
 * Positive control: run against the pre-change tree, every reader assertion fails.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const stripSqlComments = (sql: string) => sql.replace(/--.*$/gm, "");

const READERS = [
  "lib/brain/contextual-recall.ts",
  "lib/brain/memory-recall.ts",
  "lib/ai/tools/brain.ts",
] as const;

const MIGRATION = "prisma/migrations/20260923000000_brain_content_tsv/migration.sql";
const GENERATION_EXPR = "to_tsvector('english', content)";

describe("brain_memories FTS · every reader uses the stored content_tsv column", () => {
  for (const rel of READERS) {
    it(`${rel} filters and ranks on content_tsv, never on an inline to_tsvector of content`, () => {
      const code = strip(read(rel));
      // brain_memories readers name the column either as bm.content_tsv or bare content_tsv
      expect(code).toMatch(/\bcontent_tsv\s*(?:\n\s*)?@@\s*websearch_to_tsquery/);
      // No inline parse of a brain_memories content column remains in SQL text. The
      // reflections / brain_dumps FTS in brain.ts builds its expression from `${expr}`
      // over OTHER tables and is deliberately outside this contract.
      expect(code).not.toMatch(/to_tsvector\('english',\s*(?:bm\.)?content\)/);
    });
  }

  it("memory-recall keeps the KEY weighted A (parsed inline — a short column) and weights the stored content vector B", () => {
    const code = strip(read("lib/brain/memory-recall.ts"));
    expect(code).toMatch(/setweight\(to_tsvector\('english', coalesce\(bm\.key, ''\)\), 'A'\)/);
    expect(code).toMatch(/setweight\(bm\.content_tsv, 'B'\)/);
    expect(code).toMatch(/ts_rank_cd\(/);
  });
});

describe("brain_memories FTS · the migration, the Prisma guard and the sentinel agree", () => {
  it("the migration adds a GENERATED STORED tsvector with EXACTLY the readers' former inline expression, plus its GIN", () => {
    expect(existsSync(new URL(MIGRATION, root))).toBe(true);
    const sql = stripSqlComments(read(MIGRATION));
    expect(sql).toMatch(/ALTER TABLE\s+"?brain_memories"?\s+ADD COLUMN IF NOT EXISTS\s+"?content_tsv"?\s+tsvector\s+GENERATED ALWAYS AS \(to_tsvector\('english', "?content"?\)\) STORED/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS\s+"?brain_memories_content_tsv_idx"?\s+ON\s+"?brain_memories"?\s+USING GIN \("?content_tsv"?\)/i);
    // A migration that touched vector_embeddings would be the pgvector incident class.
    expect(sql).not.toMatch(/vector_embeddings/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(GENERATION_EXPR).toBe("to_tsvector('english', content)");
  });

  it("schema.prisma declares the column Unsupported with a db-generated default so db push cannot drop it (the chat_messages pattern)", () => {
    const schema = read("prisma/schema.prisma");
    const model = /model BrainMemory \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? "";
    expect(model).toMatch(/content_tsv\s+Unsupported\("tsvector"\)\?\s+@default\(dbgenerated\(\)\)/);
  });

  it("the schema sentinel expects both the column and its GIN on brain_memories", () => {
    const sentinel = strip(read("lib/db/schema-sentinel.ts"));
    expect(sentinel).toMatch(/kind:\s*"column_exists",\s*table:\s*"brain_memories",\s*column:\s*"content_tsv"/);
    expect(sentinel).toMatch(/kind:\s*"index_exists",\s*table:\s*"brain_memories",\s*indexName:\s*"brain_memories_content_tsv_idx"/);
  });
});
