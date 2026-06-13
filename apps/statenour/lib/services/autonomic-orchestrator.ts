import { prisma } from "@/lib/prisma";
import { buildCronCommandDeck } from "@/lib/services/system-pages";
import { runManifestCron } from "@/lib/services/cron-control";
import { recordCoachEvent } from "@/lib/services/coach-events";
import { daysAgo } from "@/lib/utils/datetime";
import { markVeniceQuotaExhausted, markOllamaQuotaExhausted } from "@/lib/ai/provider";
import { WorkItemStatus, TaskStatus, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

const log = logger.withSurface("services/autonomic-orchestrator");

export interface AutonomicOrchestratorResult {
  healedCrons: string[];
  cronErrors: string[];
  vacuumedTables: string[];
  indexReindexed: boolean;
  avgLatencyMs: number;
  veniceQuotaTripped: boolean;
  ollamaQuotaTripped: boolean;
  rescuedWorkItems: string[];
  prunedLogsCount: number;
  archivedTasksCount: number;
}

export async function runAutonomicOrchestrator(): Promise<AutonomicOrchestratorResult> {
  log.info("start_orchestrator");

  const result: AutonomicOrchestratorResult = {
    healedCrons: [],
    cronErrors: [],
    vacuumedTables: [],
    indexReindexed: false,
    avgLatencyMs: 0,
    veniceQuotaTripped: false,
    ollamaQuotaTripped: false,
    rescuedWorkItems: [],
    prunedLogsCount: 0,
    archivedTasksCount: 0,
  };

  // ---------------------------------------------------------------------------
  // Phase 1: Cron Self-Healing
  // ---------------------------------------------------------------------------
  try {
    const deck = await buildCronCommandDeck();
    const MAX_HEAL_PER_RUN = 3;

    for (const row of deck.rows) {
      if (result.healedCrons.length >= MAX_HEAL_PER_RUN) {
        break;
      }

      // Skip retired, disabled, or self
      if (row.mode === "retired" || !row.enabled || row.name === "cron-healer") {
        continue;
      }

      const isFailing = row.lastStatus === "failed" || row.fail14d > 0;
      const isNeverRun = row.lastRunAt === null || (row.success14d === 0 && row.fail14d === 0);

      if (isFailing || isNeverRun) {
        const reason = isFailing ? "failing" : "never_run";
        log.info("trigger_healing", { jobName: row.name, reason });

        try {
          const cronResult = await runManifestCron(row.name);
          result.healedCrons.push(row.name);

          await recordCoachEvent({
            kind: "system-alert",
            subjectId: `cron-heal:${row.name}`,
            priority: isFailing ? "P0" : "P1",
            title: `Cron Healer: Rescued ${row.name}`,
            body: `Cron job "${row.name}" was ${reason} and was automatically healed. Status: ${cronResult.status}, duration: ${cronResult.durationMs}ms.`,
            surfaces: ["scoreboard", "home"],
            extra: {
              jobName: row.name,
              reason,
              status: cronResult.status,
              durationMs: cronResult.durationMs,
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.cronErrors.push(`${row.name}: ${msg}`);
          log.error("healing_failed", { jobName: row.name, error: msg });
        }
      }
    }
  } catch (err) {
    log.error("phase_1_cron_healing_failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Database Health Engine
  // ---------------------------------------------------------------------------
  let pgModule: any;
  try {
    pgModule = await import("pg");
  } catch {
    log.error("pg_module_load_failed");
  }

  if (pgModule) {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
    if (connectionString) {
      const ClientCtor = pgModule.Client ?? pgModule.default?.Client;
      if (ClientCtor) {
        const client = new ClientCtor({ connectionString });
        try {
          await client.connect();

          // 1. Bloat-Based VACUUM
          const statsRes = await client.query(`
            SELECT relname AS table_name, 
                   n_dead_tup AS dead_rows, 
                   n_live_tup AS live_rows
            FROM pg_stat_user_tables
            WHERE schemaname = 'public';
          `);

          for (const row of statsRes.rows) {
            const deadRows = Number(row.dead_rows);
            const liveRows = Number(row.live_rows);
            const totalRows = deadRows + liveRows;
            const ratio = totalRows > 0 ? deadRows / totalRows : 0;

            if (deadRows > 1000 && ratio > 0.20) {
              const tableName = row.table_name;
              log.info("triggering_vacuum", { table: tableName, deadRows, ratio });
              await client.query(`VACUUM "${tableName}"`);
              result.vacuumedTables.push(tableName);
            }
          }

          // 2. HNSW Index Rebuilder
          const recentTraces = await prisma.agentTrace.findMany({
            where: {
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
              durationMs: { not: null },
              OR: [
                { source: "brain" },
                { label: { contains: "embedding" } },
                { label: { contains: "context" } },
              ],
            },
            select: { durationMs: true },
            take: 100,
          });

          if (recentTraces.length > 0) {
            const totalLatency = recentTraces.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
            result.avgLatencyMs = totalLatency / recentTraces.length;
            if (result.avgLatencyMs > 150) {
              log.warn("hnsw_index_latency_high", { avgLatencyMs: result.avgLatencyMs });
              await client.query("REINDEX INDEX CONCURRENTLY vector_embeddings_hnsw_1536");
              result.indexReindexed = true;
            }
          }
        } catch (dbErr) {
          log.error("db_health_engine_failed", { error: dbErr instanceof Error ? dbErr.message : String(dbErr) });
        } finally {
          await client.end().catch(() => {});
        }
      }
    } else {
      log.error("db_connection_string_missing");
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Pipeline Self-Healing & Quota Circuit Breaker
  // ---------------------------------------------------------------------------
  try {
    const recentErrors = await prisma.agentTrace.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        errorClass: { not: null },
        provider: { in: ["venice", "ollama"] },
      },
      select: {
        provider: true,
        errorClass: true,
        errorMessage: true,
      },
      take: 50,
    });

    let veniceErrorsCount = 0;
    let ollamaErrorsCount = 0;

    for (const err of recentErrors) {
      const provider = err.provider;
      const msg = (err.errorMessage ?? "").toLowerCase();
      const isQuotaOrTimeout = /402|payment|insufficient|credit|timeout|deadline|econnreset/.test(msg);

      if (provider === "venice") {
        if (/402|payment|insufficient|credit/.test(msg)) {
          result.veniceQuotaTripped = true;
        } else if (isQuotaOrTimeout) {
          veniceErrorsCount++;
        }
      } else if (provider === "ollama") {
        if (/402|quota|limit/.test(msg)) {
          result.ollamaQuotaTripped = true;
        } else if (isQuotaOrTimeout) {
          ollamaErrorsCount++;
        }
      }
    }

    if (veniceErrorsCount >= 3) {
      result.veniceQuotaTripped = true;
    }
    if (ollamaErrorsCount >= 3) {
      result.ollamaQuotaTripped = true;
    }

    if (result.veniceQuotaTripped) {
      log.warn("tripping_venice_circuit_breaker");
      markVeniceQuotaExhausted();
    }
    if (result.ollamaQuotaTripped) {
      log.warn("tripping_ollama_circuit_breaker");
      markOllamaQuotaExhausted();
    }

    // Rescues stalled WorkItems
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const stalledItems = await prisma.workItem.findMany({
      where: {
        OR: [
          { status: WorkItemStatus.CLAIMED, claimedAt: { lt: fifteenMinsAgo } },
          { status: WorkItemStatus.PENDING, createdAt: { lt: fifteenMinsAgo } },
        ],
      },
    });

    for (const item of stalledItems) {
      await prisma.workItem.update({
        where: { id: item.id },
        data: {
          status: WorkItemStatus.FAILED,
          errorCode: "STALLED",
          errorMessage: "WorkItem stuck in running/queued state for >15 minutes. Automatically marked failed by Autonomic Orchestrator.",
        },
      });
      result.rescuedWorkItems.push(item.id);

      await recordCoachEvent({
        kind: "system-alert",
        subjectId: `work-item-stalled:${item.id}`,
        priority: "P0",
        title: `WorkItem Stalled: ${item.type}`,
        body: `WorkItem "${item.id}" (type: ${item.type}) was stuck in ${item.status} status and was marked failed.`,
        surfaces: ["scoreboard", "home"],
      });
    }
  } catch (pipelineErr) {
    log.error("pipeline_self_healing_failed", { error: pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr) });
  }

  // ---------------------------------------------------------------------------
  // Phase 4: Proactive Resource Optimization & Triage
  // ---------------------------------------------------------------------------
  try {
    const highVolumeTables = ["CronJobLog", "system_metrics", "AuditEvent", "api_request_logs", "error_logs", "agent_traces", "provider_pings"];
    const rowCounts = await prisma.$queryRaw<Array<{ relname: string; n_live_tup: number }>>`
      SELECT relname, n_live_tup::int AS n_live_tup
      FROM pg_stat_user_tables
      WHERE schemaname = 'public' AND relname IN (${Prisma.join(highVolumeTables)})
    `.catch(() => [] as Array<{ relname: string; n_live_tup: number }>);

    const totalRows = rowCounts.reduce((sum, r) => sum + r.n_live_tup, 0);
    const isAggressive = totalRows > 40000;

    const pruneRetentionDays = isAggressive ? 7 : 30;
    const metricsRetentionDays = isAggressive ? 30 : 90;

    const deletedCounts: Record<string, number> = {};

    const requestLogs = await prisma.apiRequestLog.deleteMany({
      where: { createdAt: { lt: daysAgo(pruneRetentionDays) } },
    });
    deletedCounts.api_request_logs = requestLogs.count;

    const errorLogs = await prisma.errorLog.deleteMany({
      where: { createdAt: { lt: daysAgo(pruneRetentionDays) } },
    });
    deletedCounts.error_logs = errorLogs.count;

    const stateLogs = await prisma.stateLog.deleteMany({
      where: { createdAt: { lt: daysAgo(pruneRetentionDays) } },
    });
    deletedCounts.state_logs = stateLogs.count;

    const agentTraces = await prisma.agentTrace.deleteMany({
      where: { createdAt: { lt: daysAgo(pruneRetentionDays) } },
    });
    deletedCounts.agent_traces = agentTraces.count;

    const providerPings = await prisma.providerPing.deleteMany({
      where: { pingedAt: { lt: daysAgo(isAggressive ? 3 : 7) } },
    });
    deletedCounts.provider_pings = providerPings.count;

    const metrics = await prisma.systemMetric.deleteMany({
      where: { createdAt: { lt: daysAgo(metricsRetentionDays) } },
    });
    deletedCounts.system_metrics = metrics.count;

    const deviceEvents = await prisma.deviceEvent.deleteMany({
      where: { createdAt: { lt: daysAgo(metricsRetentionDays) } },
    });
    deletedCounts.device_events = deviceEvents.count;

    const genericGc = await prisma.auditEvent.deleteMany({
      where: {
        eventType: {
          notIn: ["nickstire:vendor_health", "brain_insight"],
          not: { startsWith: "cron:" },
        },
        createdAt: { lt: daysAgo(metricsRetentionDays) },
      },
    });
    deletedCounts.audit_events_generic = genericGc.count;

    // CronJobLog keeper-aware prune
    const keepers = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      SELECT id FROM cron_job_logs WHERE id IN (
        SELECT DISTINCT ON (job_name, status) id
        FROM cron_job_logs
        WHERE status IN ('success', 'failed')
        ORDER BY job_name, status, created_at DESC
      )
    `).catch(() => [] as { id: string }[]);
    const keeperIds = keepers.map((k) => k.id);
    const cronLogs = await prisma.cronJobLog.deleteMany({
      where: {
        createdAt: { lt: daysAgo(pruneRetentionDays) },
        ...(keeperIds.length > 0 ? { id: { notIn: keeperIds } } : {}),
      },
    });
    deletedCounts.cron_job_logs = cronLogs.count;

    result.prunedLogsCount = Object.values(deletedCounts).reduce((a, b) => a + b, 0);

    // Tasks Janitor
    const taskResult = await prisma.task.updateMany({
      where: {
        status: TaskStatus.READY,
        updatedAt: { lt: daysAgo(30) },
      },
      data: { status: TaskStatus.ARCHIVED },
    });
    result.archivedTasksCount = taskResult.count;

    // Log the data cleanup completed audit event
    await prisma.auditEvent.create({
      data: {
        actor: "cron:data-cleanup",
        eventType: "cron:data_cleanup_completed",
        detail: `Pruned ${result.prunedLogsCount} rows`,
        payload: {
          totalDeleted: result.prunedLogsCount,
          ranAt: new Date().toISOString(),
        },
      },
    }).catch(() => {});
  } catch (resourceErr) {
    log.error("resource_optimization_failed", { error: resourceErr instanceof Error ? resourceErr.message : String(resourceErr) });
  }

  // ---------------------------------------------------------------------------
  // Log Unified P2 Execution Event
  // ---------------------------------------------------------------------------
  try {
    await recordCoachEvent({
      kind: "system-alert",
      subjectId: "autonomic-orchestrator",
      priority: "P2",
      title: "Autonomic Orchestrator Run Completed",
      body: `Phase 1: Healed ${result.healedCrons.length} crons. Phase 2: Vacuumed ${result.vacuumedTables.length} tables. Index reindexed: ${result.indexReindexed ? "Yes" : "No"}. Phase 3: Venice Quota tripped: ${result.veniceQuotaTripped}, Ollama Quota tripped: ${result.ollamaQuotaTripped}. Rescued ${result.rescuedWorkItems.length} work items. Phase 4: Pruned ${result.prunedLogsCount} log rows. Archived ${result.archivedTasksCount} stale tasks.`,
      surfaces: ["scoreboard", "home"],
    });
  } catch (eventErr) {
    log.error("unified_event_logging_failed", { error: eventErr instanceof Error ? eventErr.message : String(eventErr) });
  }

  log.info("orchestrator_completed", { healed: result.healedCrons.length, vacuumed: result.vacuumedTables.length });
  return result;
}
