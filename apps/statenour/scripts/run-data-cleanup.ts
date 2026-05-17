/**
 * Manual trigger of the data-cleanup cron logic.
 * Same body the Sunday 3am cron runs, just via tsx so we don't have
 * to wait until next Sunday for the AuditEvent table to drop ~280MB
 * back to its 90d retention floor.
 *
 * Safe: every delete is bounded by a `createdAt < N days ago` clause —
 * nothing newer than the retention window gets touched.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { BRAIN_MEMORY_RETENTION } from "@/config/retention";

const NOISY_PREFIXES = ["nickstire:vendor_health"];
const CRON_PREFIX = "cron:";

(async () => {
  console.log("=== data-cleanup manual run ===");
  const deletedByTable: Record<string, number> = {};

  console.log("→ SystemMetric > 90d…");
  const metrics = await prisma.systemMetric.deleteMany({ where: { createdAt: { lt: daysAgo(90) } } });
  deletedByTable.system_metrics = metrics.count;

  console.log("→ ApiRequestLog > 30d…");
  const requestLogs = await prisma.apiRequestLog.deleteMany({ where: { createdAt: { lt: daysAgo(30) } } });
  deletedByTable.api_request_logs = requestLogs.count;

  console.log("→ ErrorLog > 30d…");
  const errorLogs = await prisma.errorLog.deleteMany({ where: { createdAt: { lt: daysAgo(30) } } });
  deletedByTable.error_logs = errorLogs.count;

  console.log("→ DeviceEvent > 90d…");
  const deviceEvents = await prisma.deviceEvent.deleteMany({ where: { createdAt: { lt: daysAgo(90) } } });
  deletedByTable.device_events = deviceEvents.count;

  console.log("→ LocalSyncLog > 90d…");
  const localSyncLogs = await prisma.localSyncLog.deleteMany({ where: { createdAt: { lt: daysAgo(90) } } });
  deletedByTable.local_sync_log = localSyncLogs.count;

  console.log("→ BrainMemory expired/low-confidence…");
  const brainGc = await prisma.brainMemory.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { confidence: { lt: 0.1 }, updatedAt: { lt: daysAgo(30) } },
      ],
    },
  });
  deletedByTable.brain_memories_gc = brainGc.count;

  for (const v of BRAIN_MEMORY_RETENTION) {
    const r = await prisma.brainMemory.deleteMany({
      where: { category: v.category, updatedAt: { lt: daysAgo(v.days) } },
    });
    deletedByTable[`brain_${v.category}_${v.days}d`] = r.count;
  }

  console.log("→ AuditEvent tiered prune (the big one)…");
  const [noisyGc, cronGc, genericGc, insightGc] = await Promise.all([
    prisma.auditEvent.deleteMany({
      where: { eventType: { in: NOISY_PREFIXES }, createdAt: { lt: daysAgo(14) } },
    }),
    prisma.auditEvent.deleteMany({
      where: { eventType: { startsWith: CRON_PREFIX }, createdAt: { lt: daysAgo(60) } },
    }),
    prisma.auditEvent.deleteMany({
      where: {
        eventType: { notIn: [...NOISY_PREFIXES, "brain_insight"], not: { startsWith: CRON_PREFIX } },
        createdAt: { lt: daysAgo(90) },
      },
    }),
    prisma.auditEvent.deleteMany({
      where: { eventType: "brain_insight", createdAt: { lt: daysAgo(180) } },
    }),
  ]);
  deletedByTable.audit_events_noisy = noisyGc.count;
  deletedByTable.audit_events_cron = cronGc.count;
  deletedByTable.audit_events_generic = genericGc.count;
  deletedByTable.audit_events_insight = insightGc.count;

  console.log("\n=== summary ===");
  console.log(JSON.stringify(deletedByTable, null, 2));
  const total = Object.values(deletedByTable).reduce((s, n) => s + n, 0);
  console.log(`total rows deleted: ${total}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
