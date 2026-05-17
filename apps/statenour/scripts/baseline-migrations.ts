/**
 * Baseline Prisma Migrations · v10.0.388
 *
 * The autonicks DB has 23 historical migrations (in prisma/migrations/)
 * but none are recorded in the _prisma_migrations metadata table ·
 * because the project has been using `prisma db push` not `migrate
 * deploy`. As a result, `migrate deploy` errors with P3005 (database
 * not empty + no baseline).
 *
 * This script marks each migration as already-applied via
 * `prisma migrate resolve --applied <name>` so future `migrate deploy`
 * works cleanly.
 *
 * SAFETY · `migrate resolve --applied` writes only to
 * `_prisma_migrations` (metadata table) · does NOT touch actual schema
 * or data. Idempotent · re-running is a no-op.
 *
 * Run: pnpm tsx scripts/baseline-migrations.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "prisma", "migrations");

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  BASELINE PRISMA MIGRATIONS · v10.0.388");
  console.log("═══════════════════════════════════════════════════════════");

  const migrations = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  console.log(`  Found ${migrations.length} migrations to baseline.`);
  console.log("");

  let resolved = 0;
  let alreadyApplied = 0;
  let failed = 0;
  const failures: Array<{ name: string; err: string }> = [];

  for (const name of migrations) {
    process.stdout.write(`  · ${name} ... `);
    const result = spawnSync(
      "npx",
      ["prisma", "migrate", "resolve", "--applied", name],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: process.env,
        shell: true,
      },
    );
    const out = (result.stdout || "") + (result.stderr || "");
    if (result.status === 0) {
      if (/already.* applied|already.* recorded/i.test(out)) {
        console.log("✓ already applied");
        alreadyApplied++;
      } else {
        console.log("✅ resolved");
        resolved++;
      }
    } else {
      console.log("❌");
      failed++;
      failures.push({ name, err: out.slice(0, 300) });
    }
  }

  console.log("");
  console.log(`  Resolved (newly):     ${resolved}`);
  console.log(`  Already applied:      ${alreadyApplied}`);
  console.log(`  Failed:               ${failed}`);
  if (failures.length > 0) {
    console.log("");
    console.log("  Failure details:");
    for (const f of failures) {
      console.log(`    · ${f.name}`);
      console.log(`        ${f.err.split("\n")[0]?.slice(0, 200)}`);
    }
  }
  console.log("");

  if (failed === 0) {
    console.log("  ✅ Baseline complete. Future `prisma migrate deploy` will work cleanly.");
  } else {
    console.log("  ⚠️  Some failures. Review above and retry individually:");
    console.log('    npx prisma migrate resolve --applied "<migration-name>"');
  }
  console.log("");
}

main().catch((err) => {
  console.error("❌ Baseline script failed:", err);
  process.exit(1);
});
