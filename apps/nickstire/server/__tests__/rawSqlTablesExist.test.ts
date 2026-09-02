/**
 * Raw-SQL table-existence canary (2026-09-02, admin audit correction #18).
 *
 * `processEstimateFollowUp` queried `FROM estimates` for its whole life.
 * Production never had an `estimates` table — no migration created one and
 * drizzle/schema.ts never declared one — so the job failed on every run, first
 * silently (swallowed catch), then loudly, and the audit itself mis-read the
 * failure as a missing COLUMN (F-17). Drizzle-typed reads cannot reference a
 * table that is not declared; raw `sql\`\`` reads can name anything.
 *
 * Contract: every table name that appears after FROM / JOIN / UPDATE /
 * INSERT INTO / DELETE FROM inside a `sql\`…\`` template or a raw
 * `execute(\`…\`)` string in server/ is either declared in drizzle/schema.ts
 * or listed in RAW_SQL_ONLY_TABLES with the migration that created it.
 * Positive control: a planted `FROM estimates` is caught. Stale-allowlist
 * control: an allowlisted table that becomes declared must leave the list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const APP = join(__dirname, "..", "..");

/** Tables that exist in production but are managed by raw SQL, never declared to Drizzle. */
const RAW_SQL_ONLY_TABLES: Record<string, string> = {
  customer_promises: "created by raw DDL (commitment tracking); read/written only through sql``",
  revenue_attribution_decisions: "0100-series revenue attribution ledger, raw SQL by design",
  revenue_opportunities: "0099 revenue opportunity queue, raw SQL by design (ENUM-free)",
  revenue_reconciliation_candidates: "revenue reconciliation ledger, raw SQL by design",
  revenue_reconciliation_runs: "revenue reconciliation ledger, raw SQL by design",
  vapi_legacy_backfill_runs: "one-off VAPI backfill ledger, raw SQL by design",
  __drizzle_migrations: "the migration ledger itself",
  information_schema: "MySQL catalog (schema-qualified reads: INFORMATION_SCHEMA.COLUMNS etc.)",
};

/** Not tables: SQL keywords / functions that can follow FROM in valid SQL. */
const NOT_TABLES = new Set(["dual", "unnest", "select", "values", "lateral"]);

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (/\.(ts|mts)$/.test(name) && !/\.test\.[a-z]+$/.test(name)) out.push(full);
  }
  return out;
}

function schemaTables(): Set<string> {
  const schema = readFileSync(join(APP, "drizzle", "schema.ts"), "utf8");
  return new Set([...schema.matchAll(/mysqlTable\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]));
}

/** The SQL text inside sql`` templates and raw execute/query template strings. */
function rawSqlBlocks(text: string): string[] {
  const blocks: string[] = [];
  for (const m of text.matchAll(/\bsql`([\s\S]*?)`/g)) blocks.push(m[1]);
  for (const m of text.matchAll(/\.(?:execute|query)\(\s*`([\s\S]*?)`/g)) blocks.push(m[1]);
  return blocks;
}

const TABLE_REF = /\b(?:FROM|JOIN|UPDATE|INSERT\s+(?:IGNORE\s+)?INTO|DELETE\s+FROM)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\s*\.\s*`?[A-Za-z_][A-Za-z0-9_]*`?)?/gi;

/** Table names referenced by raw SQL in one source text (schema-qualified refs yield the schema name). */
function referencedTables(source: string): Set<string> {
  const out = new Set<string>();
  // Comments can carry example SQL (`sql-safe.ts` documents `FROM x`) — not code.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  for (const block of rawSqlBlocks(text)) {
    // CTE names (`WITH weekly AS (…) … FROM weekly`) are not tables.
    const ctes = new Set<string>();
    for (const m of block.matchAll(/\b(?:WITH|,)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s+AS\s*\(/gi)) ctes.add(m[1].toLowerCase());
    // A `${...}` interpolation is a Drizzle identifier, a subquery or a value —
    // never a bare table name to check. It is replaced by a NON-identifier token
    // so an alias that follows it (`FROM ${sub} weekly`) cannot be read as a
    // table, and the upsert tail is dropped so `ON DUPLICATE KEY UPDATE col`
    // cannot be read as `UPDATE <table>`. Both were false positives on the
    // first run of this canary (15 of them, 0 real phantoms).
    const stripped = block
      .replace(/\$\{[^}]*\}/g, " #interp# ")
      .replace(/\bON\s+DUPLICATE\s+KEY\s+UPDATE[\s\S]*/i, " ")
      // string literals ('… BLOCKED FROM ORIGINATING …') and the FROM inside
      // TRIM/EXTRACT/SUBSTRING(... FROM col) are SQL syntax, not table refs
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/\b(?:TRIM|EXTRACT|SUBSTRING)\s*\([^()]*\)/gi, " ");
    for (const m of stripped.matchAll(TABLE_REF)) {
      const name = m[1].toLowerCase();
      if (!NOT_TABLES.has(name) && !ctes.has(name)) out.add(name);
    }
  }
  return out;
}

describe("every table named in raw SQL exists (declared to Drizzle, or a known raw-SQL-only table)", () => {
  const declared = schemaTables();
  const sources = listSourceFiles(join(APP, "server"));

  it("positive control — a planted phantom reference is caught", () => {
    const refs = referencedTables("const q = sql`SELECT e.id FROM estimates e WHERE e.followUpSent = 0 LIMIT 10`;");
    expect(refs.has("estimates")).toBe(true);
    expect(declared.has("estimates")).toBe(false);
    // and a declared table plus a schema-qualified catalog read are handled
    const ok = referencedTables("await db.execute(`SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE 1`); sql`UPDATE customers SET x = 1`");
    expect(ok.has("information_schema")).toBe(true);
    expect(ok.has("customers")).toBe(true);
    // the two false-positive shapes from the first run: an alias after an interpolated subquery, and an upsert column
    const fp = referencedTables("sql`SELECT * FROM ${sub} weekly JOIN ${customers} c ON 1 INSERT INTO leads (a) VALUES (1) ON DUPLICATE KEY UPDATE attempt_count = attempt_count + 1`");
    expect(fp.has("weekly")).toBe(false);
    expect(fp.has("attempt_count")).toBe(false);
    expect(fp.has("leads")).toBe(true);
    // second-run shapes: a CTE name, a code example inside a comment, TRIM(... FROM col), a string literal
    const fp2 = referencedTables([
      "/** example: sql`SELECT count(*) FROM x` */",
      "sql`WITH weekly AS (SELECT 1 FROM invoices) SELECT COUNT(*) FROM weekly`",
      "sql`UPDATE customers SET firstName = TRIM(TRAILING '\"' FROM firstName) WHERE body LIKE 'BLOCKED FROM ORIGINATING %'`",
    ].join("\n"));
    expect(fp2.has("x")).toBe(false);
    expect(fp2.has("weekly")).toBe(false);
    expect(fp2.has("firstname")).toBe(false);
    expect(fp2.has("originating")).toBe(false);
    expect(fp2.has("invoices")).toBe(true);
    expect(fp2.has("customers")).toBe(true);
  });

  it("no raw SQL in server/ names a table that exists nowhere", () => {
    const phantoms: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const t of referencedTables(text)) {
        if (declared.has(t) || t in RAW_SQL_ONLY_TABLES) continue;
        phantoms.push(`${relative(APP, file).replace(/\\/g, "/")} → ${t}`);
      }
    }
    expect(
      phantoms,
      `raw SQL references a table that is neither declared in drizzle/schema.ts nor allowlisted (the estimate-followup phantom class): ${phantoms.join(", ")}`,
    ).toEqual([]);
  });

  it("the allowlist is not stale — a table that becomes declared must leave it", () => {
    const stale = Object.keys(RAW_SQL_ONLY_TABLES).filter((t) => declared.has(t));
    expect(stale, `RAW_SQL_ONLY_TABLES entries now declared in schema.ts: ${stale.join(", ")}`).toEqual([]);
  });
});
