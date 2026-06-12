/**
 * One-shot apply for wave-181.x Tier S + Tier A migrations 0055-0060.
 *
 * Same effect as clicking admin → Run Migrations · runs the canonical
 * handleRunMigrations() so all migrations stay in lockstep with the
 * admin button path (single source of truth).
 *
 * Idempotent · uses ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT
 * EXISTS · safe to run multiple times.
 *
 * Run:
 *   DATABASE_URL=<prod-tidb-url> pnpm exec tsx scripts/apply-wave-181-x-tier-s-a.ts
 *
 * Or if DATABASE_URL is in ../../.env or apps/nickstire/.env, just:
 *   pnpm exec tsx scripts/apply-wave-181-x-tier-s-a.ts
 *
 * Covers:
 *   0055 · declined_recovery_sequence (9 ALTER + 1 INDEX on alg_estimates)
 *   0056 · customer_psycho_profile (3 ALTER + 1 INDEX on customers)
 *   0057 · vapi_call_eval (4 ALTER + 1 INDEX on vapi_call_logs)
 *   0058 · competitor_snapshots (new table)
 *   0059 · wave_metrics (new table)
 *   0060 · agentic_audit (2 ALTER + 1 INDEX on vapi_call_logs)
 *
 * Plus all prior migrations (0042 onward) baked into handleRunMigrations.
 * Already-applied items are silently skipped.
 */

import dotenv from "dotenv";
import { resolve } from "path";

// Try the monorepo root first, then apps/nickstire/.env
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("\n❌ DATABASE_URL is not set in env.\n");
    console.error("Set it inline:");
    console.error("  DATABASE_URL='<prod-tidb-url>' pnpm exec tsx scripts/apply-wave-181-x-tier-s-a.ts\n");
    console.error("Or put it in apps/nickstire/.env or NOURCITY/.env\n");
    process.exit(1);
  }

  console.log("\n═══ Wave-181.x · Tier S + A · migrations 0055-0060 ═══\n");

  // Use the canonical migrations handler · same code path as the admin
  // button · single source of truth.
  const { handleRunMigrations } = await import("../../server/routers/nick/intelligence");
  const result = await handleRunMigrations();

  if (!result.success) {
    console.error(`\n❌ FAILED · ${"error" in result ? result.error : "unknown"}\n`);
    process.exit(1);
  }

  console.log(`✓ Applied · ${"applied" in result ? result.applied : "?"} new`);
  console.log(`· Skipped · ${"skipped" in result ? result.skipped : "?"} already-present`);
  console.log(`· Total   · ${"total" in result ? result.total : "?"} migrations checked\n`);

  if ("errors" in result && result.errors && result.errors.length > 0) {
    console.warn(`⚠ ${result.errors.length} non-skip errors:`);
    for (const e of result.errors.slice(0, 10)) {
      console.warn(`  · ${e}`);
    }
    if (result.errors.length > 10) {
      console.warn(`  · + ${result.errors.length - 10} more`);
    }
    console.warn(`\nThese may be benign (e.g. column already exists in a different shape) but worth a glance.\n`);
  }

  console.log("Done. The 9 compounding loops are now backed by real schema.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n💥 UNHANDLED · ", err instanceof Error ? err.message : String(err));
  console.error(err instanceof Error && err.stack ? err.stack : "");
  process.exit(1);
});
