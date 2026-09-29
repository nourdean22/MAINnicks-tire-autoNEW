/**
 * Row-removal ratchet for the auto-applied migration path (2026-09-29).
 *
 * scripts/db-migrate.ts applies every drizzle/*.sql file it finds, journaled
 * or not, and drizzle-kit migrate applies every journaled one. So a DELETE or
 * TRUNCATE placed in drizzle/ runs against production the next time anyone
 * applies ANY later migration. 0131 did exactly that: its header said
 * "Operator-run only; never auto-applied" while it sat in the runner's path
 * with four production DELETEs (#2675).
 *
 * The rule: a migration may remove rows only if it is listed in
 * ALLOWED_ROW_REMOVAL with its reason, so every exception is a reviewed diff
 * line. An operator-only data fix belongs in docs/operations/operator-sql/,
 * which no runner reads.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");

/** Existing migrations that remove rows on purpose. Adding one is a reviewed decision. */
const ALLOWED_ROW_REMOVAL: Record<string, string> = {
  "0050_wave_audit_unique_pred_surface": "dedupes prediction_impressions before adding its UNIQUE KEY",
  "0054_amusing_starjammers": "dedupes search_performance before adding its unique index",
  "0062_search_performance_dedupe": "dedupes search_performance before adding its unique index",
  "0066_drop_engine_flags": "drops 19 decorative engine_* feature_flags rows (operator-confirmed)",
};

/**
 * Blank out comments, quoted strings and quoted identifiers in ONE pass, so
 * only executable SQL is scanned. One pass matters: stripping strings before
 * comments lets an apostrophe in a comment ("the shop's") open a fake string
 * that swallows the DELETE after it.
 */
function executableSql(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if ((c === "-" && next === "-") || c === "#") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "\\" && c !== "`") { i += 2; continue; }
        if (sql[i] === c) {
          if (sql[i + 1] === c) { i += 2; continue; }
          break;
        }
        i++;
      }
      i++;
      out += c === "`" ? "`x`" : "''";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every DELETE or TRUNCATE in the SQL. `ON DELETE CASCADE` and friends are FK actions, not deletes. */
function rowRemovingStatements(sql: string): string[] {
  const code = executableSql(sql);
  const hits = [
    ...code.matchAll(/\bDELETE\b(?!\s+(?:CASCADE|SET|RESTRICT|NO)\b)[^;]*/gi),
    // TRUNCATE(x, d) is MySQL's numeric function, not a table truncation.
    ...code.matchAll(/\bTRUNCATE\b(?!\s*\()[^;]*/gi),
  ];
  return hits.map((m) => m[0].trim().slice(0, 80));
}

function migrationsThatRemoveRows(): string[] {
  return readdirSync(join(ROOT, "drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => rowRemovingStatements(readFileSync(join(ROOT, "drizzle", f), "utf8")).length > 0)
    .map((f) => f.slice(0, -4))
    .sort();
}

describe("rowRemovingStatements (the scanner itself)", () => {
  it("finds a plain DELETE, a multi-table DELETE and a TRUNCATE", () => {
    expect(rowRemovingStatements("DELETE FROM t WHERE a = 1;")).toHaveLength(1);
    expect(rowRemovingStatements("DELETE t1 FROM t t1 JOIN t t2 ON t1.a = t2.a AND t1.id < t2.id;")).toHaveLength(1);
    expect(rowRemovingStatements("TRUNCATE TABLE t;")).toHaveLength(1);
    expect(rowRemovingStatements("-- a note\ndelete from `t` where `k` like 'cmp:%';")).toHaveLength(1);
  });

  it("an apostrophe in a comment does not hide the DELETE after it", () => {
    expect(rowRemovingStatements("-- the shop's own reviews stay\nDELETE FROM t WHERE k = 'a';")).toHaveLength(1);
    expect(rowRemovingStatements("/* it's fine */ DELETE FROM t;")).toHaveLength(1);
  });

  it("ignores FK actions, comments and string literals", () => {
    expect(rowRemovingStatements("ALTER TABLE a ADD CONSTRAINT f FOREIGN KEY (b) REFERENCES c(d) ON DELETE CASCADE ON UPDATE NO ACTION;")).toEqual([]);
    expect(rowRemovingStatements("ALTER TABLE a ADD CONSTRAINT f FOREIGN KEY (b) REFERENCES c(d) ON DELETE SET NULL;")).toEqual([]);
    expect(rowRemovingStatements("-- DELETE FROM t;\n/* TRUNCATE t; */\nSELECT 1;")).toEqual([]);
    expect(rowRemovingStatements("CREATE TABLE t (op ENUM('create','delete','truncate'));")).toEqual([]);
    expect(rowRemovingStatements("ALTER TABLE t ADD COLUMN deleted_at TIMESTAMP NULL;")).toEqual([]);
    expect(rowRemovingStatements("UPDATE t SET price = TRUNCATE(price, 2);")).toEqual([]);
  });
});

describe("drizzle migrations that remove rows", () => {
  it("are exactly the reviewed allowlist (a new DELETE/TRUNCATE in the auto-applied path fails here)", () => {
    const found = migrationsThatRemoveRows();
    const allowed = Object.keys(ALLOWED_ROW_REMOVAL).sort();
    const unreviewed = found.filter((tag) => !allowed.includes(tag));
    expect(
      unreviewed,
      `row-removing SQL in drizzle/ runs on the next db:migrate. Move an operator-only purge to docs/operations/operator-sql/, or add the migration to ALLOWED_ROW_REMOVAL with its reason: ${unreviewed.join(", ")}`,
    ).toEqual([]);
    expect(found, "an allowlisted migration no longer removes rows; drop it from ALLOWED_ROW_REMOVAL").toEqual(allowed);
  });

  it("keeps 0131's Places purge out of the runner's path", () => {
    const stub = readFileSync(join(ROOT, "drizzle", "0131_places_content_purge.sql"), "utf8");
    expect(rowRemovingStatements(stub)).toEqual([]);
    const operatorCopy = readFileSync(join(ROOT, "docs", "operations", "operator-sql", "0131_places_content_purge.sql"), "utf8");
    expect(rowRemovingStatements(operatorCopy)).toHaveLength(4);
  });
});
