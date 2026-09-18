/**
 * tests/security/prod-migration-registry-safety.test.ts
 * 2026-09-02 · added alongside the idempotency-index restore.
 *
 * `POST /api/system/apply-pending-migration` runs statements from an inlined
 * MIGRATIONS registry through `$executeRawUnsafe` against the PRODUCTION
 * database. It is deliberately not an arbitrary-SQL endpoint — only registered
 * names run — but nothing constrained what a registered name could contain.
 * The whole safety argument rested on whoever edited the registry.
 *
 * Today every statement in it is additive: ADD COLUMN, ADD CONSTRAINT,
 * CREATE INDEX/TABLE, DROP INDEX. Zero DELETE, TRUNCATE, DROP TABLE or DROP
 * COLUMN. This test makes that a property of the file rather than a fact about
 * its current contents, because the failure it guards is unrecoverable: the
 * repo's own AGENTS.md records a `--dry-run` that deleted 870 rows, and this
 * route has prod credentials and no dry run at all.
 *
 * Dropping an INDEX stays allowed — 42 statements do it, index changes are
 * reversible, and blocking them would make the gate a lie people route
 * around. Dropping a TABLE or a COLUMN, or deleting rows, is not reversible
 * and is not what a migration applied from a browser tab should be able to do.
 *
 * The subject is the route's SOURCE, not its exported registry: the constant
 * is module-private, and importing the route would drag Prisma into the test
 * to inspect a string table.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ROUTE = "app/api/system/apply-pending-migration/route.ts";

/** Every backtick-quoted SQL statement in the registry, comments excluded. */
function registryStatements(): string[] {
  const src = readFileSync(resolve(APP_ROOT, ROUTE), "utf8");
  const start = src.indexOf("const MIGRATIONS");
  expect(start, "MIGRATIONS registry not found — did the route move?").toBeGreaterThan(-1);
  const body = src.slice(start);
  return [...body.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1].replace(/\s+/g, " ").trim())
    .filter((s) => /^(CREATE|DROP|ALTER|UPDATE|DELETE|INSERT|TRUNCATE|GRANT|REVOKE)\b/i.test(s));
}

/** Verbs that destroy data or schema irreversibly from a browser tab. */
const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: "DELETE FROM", re: /\bDELETE\s+FROM\b/i },
  { label: "TRUNCATE", re: /\bTRUNCATE\b/i },
  { label: "DROP TABLE", re: /\bDROP\s+TABLE\b/i },
  { label: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/i },
  { label: "DROP SCHEMA", re: /\bDROP\s+SCHEMA\b/i },
  { label: "DROP DATABASE", re: /\bDROP\s+DATABASE\b/i },
  { label: "DROP EXTENSION", re: /\bDROP\s+EXTENSION\b/i }, // pgvector lives here
];

describe("apply-pending-migration registry · nothing irreversible reaches production", () => {
  it("no registered statement deletes rows, tables, columns or extensions", () => {
    const offenders: string[] = [];
    for (const stmt of registryStatements()) {
      for (const { label, re } of FORBIDDEN) {
        if (re.test(stmt)) offenders.push(`${label} — ${stmt.slice(0, 100)}`);
      }
    }
    expect(
      offenders,
      "This route applies SQL to the PRODUCTION database from a browser tab, with no dry run.\n" +
        "Additive DDL and DROP INDEX are fine. Row or schema destruction is not — do it as a\n" +
        "reviewed migration with a backup, not here:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("positive control · the extractor actually sees the statements", () => {
    // Without this, a regex that matched nothing would make the assertion
    // above vacuously green forever — the silent-instrument shape.
    const stmts = registryStatements();
    expect(stmts.length).toBeGreaterThan(50);
    expect(stmts.some((s) => /^CREATE INDEX/i.test(s))).toBe(true);
    expect(stmts.some((s) => /^DROP INDEX/i.test(s))).toBe(true);
    expect(stmts.some((s) => /^ALTER TABLE/i.test(s))).toBe(true);
  });

  it("the extractor would catch a destructive statement if one were added", () => {
    // Canary in-test: prove the FORBIDDEN patterns fire, so a passing run
    // means "nothing destructive is registered", not "the matcher is broken".
    const planted = [
      `DELETE FROM "brain_memories" WHERE 1=1`,
      `DROP TABLE "chat_messages"`,
      `ALTER TABLE "tasks" DROP COLUMN "title"`,
      `DROP EXTENSION vector`,
    ];
    for (const stmt of planted) {
      expect(
        FORBIDDEN.some(({ re }) => re.test(stmt)),
        `${stmt} should have been caught`,
      ).toBe(true);
    }
  });

  it("the 2026-09-02 index restore is registered and is additive only", () => {
    const src = readFileSync(resolve(APP_ROOT, ROUTE), "utf8");
    expect(src).toContain('"20260902000000_restore_idempotency_partials"');

    // Every statement in that entry must be a CREATE ... IF NOT EXISTS, so
    // re-running it is a no-op and a partial apply leaves nothing half-done.
    const entry = src.slice(src.indexOf('"20260902000000_restore_idempotency_partials"'));
    const stmts = [...entry.slice(0, entry.indexOf("],")).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(stmts).toHaveLength(6);
    for (const s of stmts) {
      expect(s, `${s.slice(0, 60)} must be additive`).toMatch(/^CREATE (UNIQUE )?INDEX IF NOT EXISTS/);
    }
    // Five partial uniques (the sentinel's HIGH findings) + one GIN (MEDIUM).
    expect(stmts.filter((s) => /CREATE UNIQUE INDEX/.test(s))).toHaveLength(5);
    expect(stmts.filter((s) => /USING GIN/.test(s))).toHaveLength(1);
  });

  it("the registered SQL matches the parked migration file it cites", () => {
    // The route and prisma/migrations-pending/<name>/migration.sql are two
    // copies of the same statements. They drift the moment someone edits one —
    // the same duplicated-fact problem this session removed from the tool
    // registries. Assert the index NAMES agree; formatting may differ.
    //
    // 2026-09-18 · the parked file is now OPTIONAL, because #2421 ("promote and
    // record the five already-applied migrations") deletes a migration's file
    // once it has been applied to production. This assertion compares two
    // copies; once promotion removes the second copy there is nothing left to
    // drift, and the check became an ENOENT that reddened main for every
    // branch cut from it.
    //
    // ★ This does NOT relax the safety property. The guard against irreversible
    // SQL is the additive-only scan over the WHOLE registry in the first test,
    // plus the per-statement CREATE ... IF NOT EXISTS assertions in the second
    // — both read the ROUTE and neither needs the file. What is conditional
    // here is only the cross-copy provenance check, and only when the copy has
    // been deliberately removed. The route side stays asserted unconditionally,
    // so a registry that loses these names still fails.
    const src = readFileSync(resolve(APP_ROOT, ROUTE), "utf8");
    const parked = resolve(
      APP_ROOT,
      "prisma/migrations-pending/20260902000000_restore_idempotency_partials/migration.sql",
    );
    const names = [
      "scheduled_actions_idempotency_key_uniq",
      "task_events_idempotency_key_uniq",
      "goal_events_idempotency_key_uniq",
      "reflections_idempotency_key_uniq",
      "decision_replays_idempotency_key_uniq",
      "chat_messages_searchable_tsv_idx",
    ];
    for (const n of names) {
      expect(src, `${n} missing from the route registry`).toContain(n);
    }
    if (!existsSync(parked)) return; // promoted: applied to prod, file removed by design
    const sql = readFileSync(parked, "utf8");
    for (const n of names) {
      expect(sql, `${n} missing from the parked migration`).toContain(n);
    }
  });
});
