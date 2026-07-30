import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { BRAIN_MEMORY_RETENTION } from "@/config/retention";
export const maxDuration = 60;

/**
 * GET /api/cron/data-cleanup — Retention cleanup
 * Deletes old records based on retention windows.
 * Schedule: 3am Sundays
 */
export const GET = cronHandler(async () => {
  const deletedByTable: Record<string, number> = {};

  // SystemMetric: 90 days
  const metrics = await prisma.systemMetric.deleteMany({
    where: { createdAt: { lt: daysAgo(90) } },
  });
  deletedByTable.system_metrics = metrics.count;

  // ApiRequestLog: 30 days
  const requestLogs = await prisma.apiRequestLog.deleteMany({
    where: { createdAt: { lt: daysAgo(30) } },
  });
  deletedByTable.api_request_logs = requestLogs.count;

  // ErrorLog: 30 days
  const errorLogs = await prisma.errorLog.deleteMany({
    where: { createdAt: { lt: daysAgo(30) } },
  });
  deletedByTable.error_logs = errorLogs.count;

  // DeviceEvent: 90 days
  const deviceEvents = await prisma.deviceEvent.deleteMany({
    where: { createdAt: { lt: daysAgo(90) } },
  });
  deletedByTable.device_events = deviceEvents.count;

  // NotificationQueue (sent/failed): 30 days
  const notifications = await Promise.resolve({ count: 0 });
  deletedByTable.notification_queue = notifications.count;

  // IntegrationSyncLog: 90 days
  const syncLogs = await Promise.resolve({ count: 0 });
  deletedByTable.integration_sync_logs = syncLogs.count;

  // LocalSyncLog: 90 days
  const localSyncLogs = await prisma.localSyncLog.deleteMany({
    where: { createdAt: { lt: daysAgo(90) } },
  });
  deletedByTable.local_sync_log = localSyncLogs.count;

  // BrainMemory: garbage collect expired low-confidence memories
  const brainGc = await prisma.brainMemory.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { confidence: { lt: 0.1 }, updatedAt: { lt: daysAgo(30) } },
      ],
    },
  });
  deletedByTable.brain_memories_gc = brainGc.count;

  // ── Commitment auto-expiry (2026-07-11) ──
  // Mirrors personal-pulse's own "abandoned-in-practice" floor: anything
  // >90d past its deadline is never getting done. Pre-fix nothing ever
  // expired these (the only expiry path was a manual bulk action last used
  // 2026-04-22) — prod accumulated 69 active commitments with ~1 ever
  // completed, poisoning the promise_integrity axis and pulse PROMISE items.
  // Status "expired" (not deleted) — same terminal state the manual
  // expire_stale action in /api/commitments uses.
  const expiredCommitments = await prisma.commitment.updateMany({
    where: {
      status: { in: ["active", "in_progress"] },
      deletedAt: null,
      deadline: { lt: daysAgo(90).toISOString().slice(0, 10) },
    },
    data: { status: "expired", updatedBy: "cron:data-cleanup" },
  });
  deletedByTable.commitments_expired = expiredCommitments.count;

  // v11.0 · BrainMemory category retention · read from config/retention.ts
  // so /system/gaps + /system/power + this cron all share one source
  // of truth. Each sweep records its deletion count AND the why-line
  // so CronJobLog entries are self-explaining.
  const brainMemoryReport: Array<{ category: string; days: number; deleted: number; why: string }> = [];
  for (const v of BRAIN_MEMORY_RETENTION) {
    const r = await prisma.brainMemory.deleteMany({
      where: { category: v.category, updatedAt: { lt: daysAgo(v.days) } },
    });
    deletedByTable[`brain_${v.category}_${v.days}d`] = r.count;
    brainMemoryReport.push({ category: v.category, days: v.days, deleted: r.count, why: v.why });
  }

  // ── AuditEvent retention (Apr 18) ──
  // Tiered so the high-signal rows stick around while heartbeat noise
  // gets pruned fast. Quality-sweep Apr 17 showed nickstire:vendor_health
  // alone eating 40% of the 7d audit log — that's pure beat-monitoring,
  // 14d is plenty.
  //
  //   nickstire:vendor_health    → 14d  (external heartbeat, noisy)
  //   cron:*                     → 60d  (execution traces)
  //   brain_insight              → 180d (watcher + distilled wisdom)
  //   everything else (default)  → 90d
  const NOISY_PREFIXES = ["nickstire:vendor_health"];
  const CRON_PREFIX = "cron:";
  const [noisyGc, cronGc, genericGc, insightGc] = await Promise.all([
    prisma.auditEvent.deleteMany({
      where: {
        eventType: { in: NOISY_PREFIXES },
        createdAt: { lt: daysAgo(14) },
      },
    }),
    prisma.auditEvent.deleteMany({
      where: {
        eventType: { startsWith: CRON_PREFIX },
        createdAt: { lt: daysAgo(60) },
      },
    }),
    prisma.auditEvent.deleteMany({
      where: {
        eventType: {
          notIn: [...NOISY_PREFIXES, "brain_insight"],
          not: { startsWith: CRON_PREFIX },
        },
        createdAt: { lt: daysAgo(90) },
      },
    }),
    prisma.auditEvent.deleteMany({
      where: {
        eventType: "brain_insight",
        createdAt: { lt: daysAgo(180) },
      },
    }),
  ]);
  deletedByTable.audit_events_noisy = noisyGc.count;
  deletedByTable.audit_events_cron = cronGc.count;
  deletedByTable.audit_events_generic = genericGc.count;
  deletedByTable.audit_events_insight = insightGc.count;

  // ── v11.0 new sweeps (W5) ────────────────────────────────────────
  // CronJobLog: 30d, but keep last success + last failure per jobName
  // forever. Two-step: find the keepers, then delete everything else
  // older than 30d.
  const keepers = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM cron_job_logs WHERE id IN (
      SELECT DISTINCT ON (job_name, status) id
      FROM cron_job_logs
      WHERE status IN ('success', 'failed')
      ORDER BY job_name, status, created_at DESC
    )
  `.catch(() => [] as { id: string }[]);
  const keeperIds = keepers.map((k) => k.id);
  const cronLogs = await prisma.cronJobLog.deleteMany({
    where: {
      createdAt: { lt: daysAgo(30) },
      ...(keeperIds.length > 0 ? { id: { notIn: keeperIds } } : {}),
    },
  });
  deletedByTable.cron_job_logs = cronLogs.count;

  // StateLog: 30d
  const stateLogs = await prisma.stateLog.deleteMany({
    where: { createdAt: { lt: daysAgo(30) } },
  });
  deletedByTable.state_logs = stateLogs.count;

  // SituationLog: 90d (rolling-trend widget data)
  const situationLogs = await prisma.situationLog.deleteMany({
    where: { createdAt: { lt: daysAgo(90) } },
  });
  deletedByTable.situation_logs = situationLogs.count;

  // DeviceCommand: completed only, 30d. Pending + failed kept forever.
  const deviceCmds = await prisma.deviceCommand.deleteMany({
    where: {
      status: "completed",
      createdAt: { lt: daysAgo(30) },
    },
  });
  deletedByTable.device_commands_completed = deviceCmds.count;

  // RecoveryActionLog: 90d
  const recoveryLogs = await prisma.recoveryActionLog.deleteMany({
    where: { createdAt: { lt: daysAgo(90) } },
  });
  deletedByTable.recovery_action_logs = recoveryLogs.count;

  // ReviewLog: 365d
  const reviewLogs = await prisma.reviewLog.deleteMany({
    where: { createdAt: { lt: daysAgo(365) } },
  });
  deletedByTable.review_logs = reviewLogs.count;

  // v10.0.199 · AgentTrace: 30d. Append-only · was missing TTL.
  // Without this the table grew unbounded; report findings in the
  // last session showed 1.1K rows / 1MB today, but write rate is
  // climbing (multiple writes per chat turn). 30d hot is plenty
  // for /system/agent-traces dashboards.
  const agentTraces = await prisma.agentTrace.deleteMany({
    where: { createdAt: { lt: daysAgo(30) } },
  });
  deletedByTable.agent_traces = agentTraces.count;

  // v10.0.199 · AutonomousEvent: 90d. Append-only event log; 90d
  // window covers /system/autonomous-actions trend widgets.
  const autonomousEvents = await prisma.autonomousEvent.deleteMany({
    where: { firedAt: { lt: daysAgo(90) } },
  });
  deletedByTable.autonomous_events = autonomousEvents.count;

  // v10.0.199 · ToolVerbRatio: 30d. Per-turn fab-defense signal;
  // beyond 30d it's noise.
  const toolVerbRatios = await prisma.toolVerbRatio.deleteMany({
    where: { createdAt: { lt: daysAgo(30) } },
  });
  deletedByTable.tool_verb_ratios = toolVerbRatios.count;

  const totalDeleted = Object.values(deletedByTable).reduce((a, b) => a + b, 0);

  // v10.0.34 — audit trail for the cleanup. Pre-fix this cron mass-
  // deleted BrainMemory + AuditEvent rows with no record in
  // entity_audits or AuditEvent itself — exactly the pattern the
  // v8 phase-2A entity-audit work was designed to prevent. One
  // summary row per cron run is enough; per-table breakdown is in
  // the payload so a `SELECT FROM audit_events WHERE eventType =
  // 'cron:data_cleanup'` recovery query stays self-explaining.
  await prisma.auditEvent
    .create({
      data: {
        actor: "cron:data-cleanup",
        eventType: "cron:data_cleanup_completed",
        detail: `Pruned ${totalDeleted} rows across ${Object.keys(deletedByTable).length} tables`,
        payload: {
          totalDeleted,
          deletedByTable,
          brainMemoryReport,
          ranAt: new Date().toISOString(),
        },
      },
    })
    .catch(() => {
      // Audit-log failure must NEVER block the cleanup result. Worst
      // case: a single missing audit row, which is still better than
      // failing the whole cleanup.
    });

  return { deletedByTable, totalDeleted, brainMemoryReport };
});
