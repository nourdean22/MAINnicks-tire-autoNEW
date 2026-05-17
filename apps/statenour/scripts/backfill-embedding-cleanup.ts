/**
 * Vector embedding orphan cleanup runner · v10.0.192
 *
 * Wraps lib/db/embedding-cleanup.ts so the operator can run it once
 * to drain the backlog, then the cron picks up the maintenance job.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-embedding-cleanup.ts --dry-run
 *   pnpm tsx scripts/backfill-embedding-cleanup.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { runEmbeddingCleanup } from "@/lib/db/embedding-cleanup";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

async function main() {
  const report = await runEmbeddingCleanup({ dryRun });

  console.log("\nEmbedding cleanup report");
  console.log(`  dry run: ${dryRun ? "yes" : "no"}`);
  console.log("\n  before / deleted / after");
  for (const [k, before] of Object.entries(report.before)) {
    const del = report.deleted[k] ?? 0;
    const after = report.after[k] ?? before;
    console.log(`  ${k.padEnd(28)} ${String(before).padStart(6)}  ${String(del).padStart(6)}  ${String(after).padStart(6)}`);
  }
  console.log(`\n  total deleted: ${report.totalDeleted}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
