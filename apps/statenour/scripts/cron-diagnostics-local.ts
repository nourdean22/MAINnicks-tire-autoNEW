/**
 * One-shot cron-diagnostics runner that hits the prod Neon DB directly
 * using the local .env DATABASE_URL. Prints the same CronHealthReport
 * as /api/system/cron-diagnostics, without needing a session cookie.
 *
 * v11.2 · Thin-wrapped around lib/system/cron-diagnostics so the
 * script + the web endpoint stay in lock-step. Previously each
 * hand-duplicated ~200 LOC of identical analysis.
 *
 * Usage: pnpm tsx scripts/cron-diagnostics-local.ts
 */

import { scanCronHealth } from "@/lib/system/cron-diagnostics";
import { prisma } from "@/lib/prisma";

async function main() {
  const report = await scanCronHealth();
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("cron-diagnostics-local FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
