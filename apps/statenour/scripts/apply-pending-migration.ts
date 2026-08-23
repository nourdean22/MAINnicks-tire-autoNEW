/**
 * scripts/apply-pending-migration.ts · v10.0.529 helper
 *
 * Runs a `migrations-pending/<name>/migration.sql` file against the
 * configured Neon DB via the `pg` driver in AUTOCOMMIT mode — each
 * statement is its own transaction, which is the ONLY way to run
 * `CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY` (those
 * statements refuse to execute inside a transaction block, and
 * `prisma db execute --file` wraps the whole file in one).
 *
 * Usage:
 *   set -a && . ./.env.local && set +a
 *   pnpm tsx scripts/apply-pending-migration.ts \
 *     prisma/migrations-pending/20260512_v526_index_optimization/migration.sql
 *
 * Behavior:
 *   · Reads + parses statements on `;` boundaries (comments stripped)
 *   · Skips empty/comment-only fragments
 *   · Runs each statement on its own and prints a one-line result
 *   · Idempotent · the v526 migration uses IF NOT EXISTS + IF EXISTS,
 *     so a re-run is safe
 *   · Continues on per-statement errors (logs + counts) so a single
 *     "already exists" warning doesn't abort the run
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

// ─────────────────────────────────────────────────────────────────
// TZ=UTC — PIN THE READER, NOT THE SCHEMA. Read this before "fixing"
// the columns instead.
//
// Most timestamp columns in this database are `timestamp without time
// zone` holding UTC. That is a PostgreSQL anti-pattern on paper, and on
// 2026-08-23 it produced a real incident: a 13-hour-old write was read
// as ~6 minutes old and a rollback of a healthy production migration
// was nearly ordered on it.
//
// The obvious conclusion — migrate everything to timestamptz — is
// WRONG, and it was measured wrong rather than argued wrong:
//
//   · Prisma's engine parses these columns as UTC CORRECTLY. The
//     application has never been affected. Measured on one row:
//     Prisma 13:45:04Z vs node-pg 17:45:04Z against a now() of
//     14:26:02Z.
//   · node-pg parses `timestamp without time zone` in the PROCESS's
//     local zone. On ET that is +4h. The skew is entirely in raw-pg
//     tooling — scripts like this one — not in the app.
//   · The migration would touch 272 columns / 103 tables / 4,155 MB,
//     and its failure mode is silent: converting with the session TZ
//     set wrong writes wrong instants with no error.
//
// So the fix is one line in the reader, not 4 GB of rewrites. Setting
// TZ here makes every Date this script builds a true instant.
//
// Rejected proposal recorded in full, with the measurements, at
// docs/agent-audit/DEFECT-SHAPE-ORPHANED-SUBJECT.md.
// ─────────────────────────────────────────────────────────────────
process.env.TZ = "UTC";

const { Client } = pg;

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error("usage: pnpm tsx scripts/apply-pending-migration.ts <migration.sql>");
    process.exit(2);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set · load .env.local first");
    process.exit(2);
  }

  const filepath = resolve(fileArg);
  const raw = readFileSync(filepath, "utf8");

  // Strip SQL line-comments + block-comments, then split on `;`.
  // We keep the original simple parser — the migration files we
  // generate don't use semicolons inside strings or DO blocks.
  const stripped = raw
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`apply-pending-migration · ${filepath}`);
  console.log(`  ${statements.length} statements to run · autocommit · best-effort`);
  console.log("");

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  let ok = 0;
  let warned = 0;
  let failed = 0;

  for (let i = 0; i < statements.length; i++) {
    const sql = statements[i];
    const preview = sql.replace(/\s+/g, " ").slice(0, 110);
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview} ... `);
    try {
      await client.query(sql);
      console.log("ok");
      ok += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Treat "already exists" + "does not exist" as warnings on idempotent migrations.
      if (
        /already exists|does not exist|cannot drop because.*depends on/.test(msg)
      ) {
        console.log(`warn · ${msg.split("\n")[0]}`);
        warned += 1;
      } else {
        console.log(`FAIL · ${msg.split("\n")[0]}`);
        failed += 1;
      }
    }
  }

  await client.end();

  console.log("");
  console.log(
    `done · ok=${ok} warned=${warned} failed=${failed} of ${statements.length}`,
  );

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("apply-pending-migration crashed:", err);
  process.exit(1);
});
