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
