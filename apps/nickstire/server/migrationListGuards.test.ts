/**
 * The built-in migration list (handleRunMigrations, server/routers/nick/
 * intelligence.ts) re-runs EVERY statement on every run, and since 2026-09-23
 * a one-tap card in Admin → System Health runs it. So a statement in that
 * list must be safe to run a hundred times against live data.
 *
 * WHY: the list carried `UPDATE shop_settings SET value = '100' WHERE key =
 * 'tireMarkup'` (a one-time force-sync from drizzle/0054). With a button in
 * front of it, one tap would have reset any markup the operator had edited.
 * Found by an independent review of #2561, removed the same day; production
 * showed it had never changed the value.
 *
 * Reads the list out of the source, the same way the server sees it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(path.resolve(__dirname, "routers/nick/intelligence.ts"), "utf8");

/** Every template-literal statement between `const migrations` and the run loop. */
function migrationStatements(): string[] {
  const start = SOURCE.indexOf("const migrations");
  const end = SOURCE.indexOf("let applied = 0", start);
  if (start === -1 || end === -1 || end <= start) throw new Error("could not bracket the migration list");
  const body = SOURCE.slice(start, end).replace(/^\s*\/\/.*$/gm, "");
  // A statement may contain escaped backticks (\`key\`), so match those as content.
  return [...body.matchAll(/`((?:\\`|[^`])*)`/g)].map((m) => m[1].replace(/\\`/g, "`").replace(/\s+/g, " ").trim());
}

/** Data-changing statements allowed in the list: one-time dedupes, each followed
 *  in the list by the unique key that makes a second run a no-op. */
const GUARDED_DATA_FIXES = ["prediction_impressions", "search_performance"];

describe("the re-runnable migration list never rewrites live data", () => {
  const statements = migrationStatements();

  it("canary: the extraction reads the real list (a failed read would pass everything below)", () => {
    expect(statements.length).toBeGreaterThan(100);
    expect(statements.some((s) => s.startsWith("ALTER TABLE candidates ADD COLUMN IF NOT EXISTS intent"))).toBe(true);
    expect(statements.some((s) => s.includes("INSERT IGNORE INTO shop_settings (`key`"))).toBe(true);
  });

  it("no statement updates or deletes shop_settings (operator-edited values like tireMarkup)", () => {
    const hits = statements.filter((s) => /^(UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+shop_settings\b/i.test(s));
    expect(hits).toEqual([]);
  });

  it("no DROP, TRUNCATE or unguarded UPDATE/DELETE anywhere in the list", () => {
    const destructive = statements.filter((s) => /^(DROP|TRUNCATE)\b/i.test(s) || /\bDROP\s+(TABLE|COLUMN|INDEX)\b/i.test(s));
    expect(destructive).toEqual([]);
    const writes = statements.filter((s) => /^(UPDATE|DELETE\s+FROM)\s+/i.test(s));
    for (const w of writes) {
      const table = w.replace(/^(UPDATE|DELETE\s+FROM)\s+/i, "").split(/\s/)[0];
      expect(GUARDED_DATA_FIXES, `unguarded data write on ${table}: ${w.slice(0, 80)}`).toContain(table);
    }
  });

  it("every guarded dedupe is followed by the unique key that makes a re-run a no-op", () => {
    const uniqueAt = (table: string) =>
      statements.findIndex((s) => new RegExp(`^ALTER TABLE ${table} ADD UNIQUE KEY`, "i").test(s));
    for (const table of GUARDED_DATA_FIXES) {
      const lastWrite = statements.map((s, i) => (/^(UPDATE|DELETE\s+FROM)\s+/i.test(s) && s.includes(table) ? i : -1)).filter((i) => i >= 0).pop();
      expect(lastWrite, `${table} has no data fix in the list any more — drop it from GUARDED_DATA_FIXES`).toBeDefined();
      expect(uniqueAt(table)).toBeGreaterThan(lastWrite!);
    }
  });

  it("no statement references the retired vehicles table (drizzle/0117) — it errored on every run", () => {
    expect(statements.filter((s) => /\bALTER TABLE vehicles\b/i.test(s))).toEqual([]);
  });
});

/**
 * 2026-10-02 · A `MODIFY COLUMN … ENUM(...)` in this list is not idempotent the way
 * `IF NOT EXISTS` is: it RE-ASSERTS the enum on every run. If a later migration appends a
 * value and this entry is not updated, the next tap shrinks the live enum — and TiDB strict
 * mode then rejects (loses) every row written with the dropped value. So every such entry
 * must equal the schema.ts enum, value for value, in order.
 */
describe("re-asserted ENUMs in the list match drizzle/schema.ts exactly", () => {
  const SCHEMA = readFileSync(path.resolve(__dirname, "../drizzle/schema.ts"), "utf8");
  const enumModifies = migrationStatements()
    .map((s) => /^ALTER TABLE `?(\w+)`? MODIFY COLUMN `?(\w+)`? ENUM\(([^)]*)\)/i.exec(s))
    .filter((m): m is RegExpExecArray => m !== null);

  /** Values of mysqlEnum("<column>", [...]) inside mysqlTable("<table>", ...) in schema.ts. */
  function schemaEnum(table: string, column: string): string[] | null {
    const start = SCHEMA.indexOf(`mysqlTable("${table}"`);
    if (start === -1) return null;
    const next = SCHEMA.indexOf("mysqlTable(", start + 10);
    const block = SCHEMA.slice(start, next === -1 ? undefined : next);
    const m = new RegExp(`mysqlEnum\\("${column}",\\s*\\[([^\\]]*)\\]`).exec(block);
    return m ? [...m[1].matchAll(/"([^"]*)"/g)].map((v) => v[1]) : null;
  }

  it("canary: the 0136 heldout re-assertions are found (an empty scan would pass vacuously)", () => {
    expect(enumModifies.map((m) => m[1]).sort()).toEqual(
      expect.arrayContaining(["review_requests", "sms_campaign_sends", "winback_sends"]),
    );
  });

  it("each re-asserted ENUM equals its schema.ts enum", () => {
    for (const [, table, column, list] of enumModifies) {
      const listed = [...list.matchAll(/'([^']*)'/g)].map((v) => v[1]);
      expect(schemaEnum(table, column), `${table}.${column} has no schema.ts enum`).not.toBeNull();
      expect(listed, `${table}.${column}: list entry would re-assert a different enum`).toEqual(schemaEnum(table, column));
    }
  });
});
