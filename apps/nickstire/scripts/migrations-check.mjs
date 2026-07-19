#!/usr/bin/env node
/**
 * Gate wrapper around reconcile-migrations --strict.
 *
 * WHY A WRAPPER
 * --strict has three outcomes and a build gate needs to treat them differently:
 *   exit 0  ledgers agree                      -> pass
 *   exit 1  DRIFT: a migration the database has no record of, a file missing
 *           from the journal, or a journal entry with no file
 *                                              -> FAIL, loudly
 *   exit 2  could not inspect (no DATABASE_URL, database unreachable)
 *                                              -> SKIP
 *
 * THE SKIP IS THE DANGEROUS ONE. "We could not check" must never be rendered as
 * "everything is fine" — that is the exact unknown-equals-healthy failure this
 * codebase has now removed from the publish gate, the HQ counter and the Action
 * Center. So the skip prints a banner saying drift was NOT checked, and says why.
 * A developer without production credentials gets a clear skip; a deploy
 * preflight with credentials gets a real gate.
 *
 * Set MIGRATIONS_CHECK_REQUIRE_DB=1 where a database MUST be reachable (deploy
 * preflight) and the skip becomes a failure too.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = ["--strict", ...process.argv.slice(2)];

const res = spawnSync(process.execPath, [path.join(HERE, "reconcile-migrations.mjs"), ...args], {
  stdio: "inherit",
  env: process.env,
});

const code = res.status ?? 2;

if (code === 0) process.exit(0);

if (code === 1) {
  console.error("\n✗ MIGRATION DRIFT — the database and the repo disagree about what has been applied.");
  console.error("  Fix before deploying: a fresh environment would build a different schema than production has.");
  process.exit(1);
}

// code 2 (or anything unexpected): could not inspect.
const mustHaveDb = process.env.MIGRATIONS_CHECK_REQUIRE_DB === "1";
console.error("\n⚠ MIGRATION CHECK SKIPPED — no database was reachable, so drift was NOT checked.");
console.error("  This is NOT a clean bill of health. Set DATABASE_URL to run the real gate.");
if (mustHaveDb) {
  console.error("  MIGRATIONS_CHECK_REQUIRE_DB=1 is set, so a skip counts as a failure here.");
  process.exit(1);
}
process.exit(0);
