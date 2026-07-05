/**
 * Manual trigger of the data-cleanup cron logic.
 * Same body the Sunday 3am cron runs, just via tsx so we don't have
 * to wait until next Sunday for the AuditEvent table to drop ~280MB
 * back to its 90d retention floor.
 *
 * Every delete is bounded by a `createdAt < N days ago` clause — nothing
 * newer than the retention window gets touched. But this points at the
 * live Neon DB via .env.local, so:
 *
 *   DEFAULT (no flag)  → DRY-RUN: counts what WOULD be deleted, deletes
 *                        nothing. Safe to run to "preview".
 *   --apply            → actually runs the deleteMany() calls, gated
 *                        behind confirmDatabase() (needs CONFIRM_PROD=1
 *                        for a production target).
 *
 *   pnpm tsx scripts/run-data-cleanup.ts            # preview only
 *   CONFIRM_PROD=1 pnpm tsx scripts/run-data-cleanup.ts --apply
 */
import { loadEnv, confirmDatabase } from "./_lib/safety";

const NOISY_PREFIXES = ["nickstire:vendor_health"];
const CRON_PREFIX = "cron:";

async function main() {
  loadEnv();
  const apply = process.argv.includes("--apply");

  // Only a real --apply run may touch the DB — guard it behind the
  // production confirmation gate. Dry-run reads (count) are always safe.
  if (apply) {
    await confirmDatabase("run-data-cleanup APPLY");
  }

  // Import Prisma AFTER loadEnv() — prisma reads DATABASE_URL at module
  // init, so importing it before loadEnv() binds a stale/placeholder URL.
  const { prisma } = await import("@/lib/prisma");
  const { daysAgo } = await import("@/lib/utils/datetime");
  const { BRAIN_MEMORY_RETENTION } = await import("@/config/retention");

  const mode = apply ? "APPLY (deleting)" : "DRY-RUN (counting only, no deletes)";
  console.log(`=== data-cleanup manual run — ${mode} ===`);
  const affectedByTable: Record<string, number> = {};

  // In dry-run we count what the same `where` would match; in apply we
  // actually delete. Both return the number of affected rows.
  const purge = async (
    label: string,
    model: { count: (a: { where: unknown }) => Promise<number>; deleteMany: (a: { where: unknown }) => Promise<{ count: number }> },
    where: unknown,
  ): Promise<number> => {
    if (apply) {
      const r = await model.deleteMany({ where });
      return r.count;
    }
    return model.count({ where });
  };

  console.log("→ SystemMetric > 90d…");
  affectedByTable.system_metrics = await purge("system_metrics", prisma.systemMetric, {
    createdAt: { lt: daysAgo(90) },
  });

  console.log("→ ApiRequestLog > 30d…");
  affectedByTable.api_request_logs = await purge("api_request_logs", prisma.apiRequestLog, {
    createdAt: { lt: daysAgo(30) },
  });

  console.log("→ ErrorLog > 30d…");
  affectedByTable.error_logs = await purge("error_logs", prisma.errorLog, {
    createdAt: { lt: daysAgo(30) },
  });

  console.log("→ DeviceEvent > 90d…");
  affectedByTable.device_events = await purge("device_events", prisma.deviceEvent, {
    createdAt: { lt: daysAgo(90) },
  });

  console.log("→ LocalSyncLog > 90d…");
  affectedByTable.local_sync_log = await purge("local_sync_log", prisma.localSyncLog, {
    createdAt: { lt: daysAgo(90) },
  });

  console.log("→ BrainMemory expired/low-confidence…");
  affectedByTable.brain_memories_gc = await purge("brain_memories_gc", prisma.brainMemory, {
    OR: [
      { expiresAt: { lt: new Date() } },
      { confidence: { lt: 0.1 }, updatedAt: { lt: daysAgo(30) } },
    ],
  });

  for (const v of BRAIN_MEMORY_RETENTION) {
    affectedByTable[`brain_${v.category}_${v.days}d`] = await purge(
      `brain_${v.category}`,
      prisma.brainMemory,
      { category: v.category, updatedAt: { lt: daysAgo(v.days) } },
    );
  }

  console.log("→ AuditEvent tiered prune (the big one)…");
  affectedByTable.audit_events_noisy = await purge("audit_events_noisy", prisma.auditEvent, {
    eventType: { in: NOISY_PREFIXES },
    createdAt: { lt: daysAgo(14) },
  });
  affectedByTable.audit_events_cron = await purge("audit_events_cron", prisma.auditEvent, {
    eventType: { startsWith: CRON_PREFIX },
    createdAt: { lt: daysAgo(60) },
  });
  affectedByTable.audit_events_generic = await purge("audit_events_generic", prisma.auditEvent, {
    eventType: { notIn: [...NOISY_PREFIXES, "brain_insight"], not: { startsWith: CRON_PREFIX } },
    createdAt: { lt: daysAgo(90) },
  });
  affectedByTable.audit_events_insight = await purge("audit_events_insight", prisma.auditEvent, {
    eventType: "brain_insight",
    createdAt: { lt: daysAgo(180) },
  });

  console.log("\n=== summary ===");
  console.log(JSON.stringify(affectedByTable, null, 2));
  const total = Object.values(affectedByTable).reduce((s, n) => s + n, 0);
  const verb = apply ? "deleted" : "WOULD delete (dry-run)";
  console.log(`total rows ${verb}: ${total}`);
  if (!apply) {
    console.log("\n(dry-run only — pass --apply to actually delete; CONFIRM_PROD=1 required for prod)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
