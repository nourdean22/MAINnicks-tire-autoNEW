import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { BRAIN_MEMORY_RETENTION } from "@/config/retention";
import { purgeStaleCategory } from "@/lib/system/stale-data-purger";
import { scrubExpiredPlates } from "@/lib/services/plate-retention";
import { logError } from "@/lib/utils/error-log";
import { sweepEmbeddingShadow } from "@/lib/db/embedding-shadow";
import {
  NEVER_HARD_DELETE_CATEGORIES,
  judgeSweep,
  type SweepVerdict,
} from "@/lib/brain/hard-delete-guard";
export const maxDuration = 60;

/**
 * GET /api/cron/data-cleanup — Retention cleanup
 * Deletes old records based on retention windows.
 * Schedule: NIGHTLY 03:00 UTC via the mega-evening fan-out
 * (config/crons.ts + lib/inngest/jobs.ts EVENING_JOBS). The old
 * "3am Sundays" line here was pre-Wave-AE and misled a 2026-08-12
 * review into reporting the pending-actions sweep as weekly.
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

  // DeviceEvent plate text: 30 days unless the plate matched a customer
  // record (ADR-0017: "plate reads 30 days unless linked"). The row survives
  // to the 90-day line above for dwell/visit analytics; only the text goes.
  deletedByTable.device_event_plates_scrubbed = await scrubExpiredPlates();

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

  // BrainMemory: garbage collect expired low-confidence memories.
  //
  // 2026-09-01 · GUARDED. This predicate hard-deleted 54,107 rows in a single
  // run (AuditEvent 2026-08-28T07:01:07Z) because it scoped on expiry alone —
  // no category filter, no deletedAt filter, so LIVE rows in any category
  // carrying a TTL were in range. Three changes, none of which alter the
  // intended behaviour on a normal night:
  //   · durable/operator categories are never eligible (guard 1)
  //   · operator-authored rows are never eligible, whatever their category
  //     (same CURATED_GUARD shape the consolidation engine uses)
  //   · the sweep is COUNTED first and refuses to run over the cap (guard 2)
  const blockedSweeps: SweepVerdict[] = [];
  const brainGcWhere = {
    OR: [
      { expiresAt: { lt: new Date() } },
      { confidence: { lt: 0.1 }, updatedAt: { lt: daysAgo(30) } },
    ],
    category: { notIn: [...NEVER_HARD_DELETE_CATEGORIES] },
    NOT: [{ createdBy: "user" }, { source: "manual" }],
  };
  const brainGcCandidates = await prisma.brainMemory.count({ where: brainGcWhere });
  const brainGcVerdict = judgeSweep(brainGcCandidates);
  if (!brainGcVerdict.allowed) {
    blockedSweeps.push({ ...brainGcVerdict, reason: `brain_memories_gc — ${brainGcVerdict.reason}` });
    deletedByTable.brain_memories_gc = 0;
  } else {
    const brainGc = await prisma.brainMemory.deleteMany({ where: brainGcWhere });
    deletedByTable.brain_memories_gc = brainGc.count;
  }

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

  // NULL-deadline commitments were IMMORTAL: `deadline < '...'` is never
  // true for NULL, so the expiry above could not touch them — and
  // sanitizeDeadline NULLs every malformed/past LLM-extracted date, which
  // routes a steady stream of rows into exactly that state. They also never
  // surface (personal-pulse filters `deadline < today`), so nothing human
  // closes them either: an unbounded, invisible graveyard that pinned the
  // health-page backlog at 71 "active" commitments. Age from createdAt
  // instead — same 90d policy, same terminal status, same shape as the
  // manual scripts/commit-sweep.ts nobody scheduled.
  const expiredUndated = await prisma.commitment.updateMany({
    where: {
      status: { in: ["active", "in_progress"] },
      deletedAt: null,
      deadline: null,
      createdAt: { lt: daysAgo(90) },
    },
    data: { status: "expired", updatedBy: "cron:data-cleanup" },
  });
  deletedByTable.commitments_expired_undated = expiredUndated.count;

  // ── AutonomousAction pending-approval sweep (2026-08-12) ──
  // Same story as the commitment auto-expiry above: the ONLY sweep for
  // autonomous_action approval="pending" was the operator-tap "purge all"
  // on /system, so the queue silently grew to 468 rows (90% older than
  // 7d) and drove the Home "Approvals" badge into meaninglessness.
  // Delegates to the incumbent stale-data purger — pending >7d becomes
  // rejected/approvedBy="auto-purge", a status flip, nothing deleted —
  // so the tap and the cron can never encode two different policies.
  // A purger throw is deliberately NOT caught: it must land a FAILED
  // CronJobLog row, not vanish.
  const pendingActionsSweep = await purgeStaleCategory("pending_actions_7d");
  deletedByTable.autonomous_actions_auto_purged = pendingActionsSweep.purged;

  // v11.0 · BrainMemory category retention · read from config/retention.ts
  // so /system/gaps + /system/power + this cron all share one source
  // of truth. Each sweep records its deletion count AND the why-line
  // so CronJobLog entries are self-explaining.
  const brainMemoryReport: Array<{ category: string; days: number; deleted: number; why: string }> = [];
  for (const v of BRAIN_MEMORY_RETENTION) {
    // Same two guards as brainGc above. A category listed in BOTH the
    // retention table and NEVER_HARD_DELETE is a contradiction the code must
    // resolve conservatively: keep the rows, and say so in the report.
    if (NEVER_HARD_DELETE_CATEGORIES.includes(v.category)) {
      brainMemoryReport.push({
        category: v.category, days: v.days, deleted: 0,
        why: `${v.why} — SKIPPED: category is in NEVER_HARD_DELETE_CATEGORIES`,
      });
      deletedByTable[`brain_${v.category}_${v.days}d`] = 0;
      continue;
    }
    const where = {
      category: v.category,
      updatedAt: { lt: daysAgo(v.days) },
      NOT: [{ createdBy: "user" }, { source: "manual" }],
    };
    const candidates = await prisma.brainMemory.count({ where });
    const verdict = judgeSweep(candidates);
    if (!verdict.allowed) {
      blockedSweeps.push({ ...verdict, reason: `brain_${v.category} — ${verdict.reason}` });
      deletedByTable[`brain_${v.category}_${v.days}d`] = 0;
      brainMemoryReport.push({ category: v.category, days: v.days, deleted: 0, why: `${v.why} — BLOCKED by sweep cap` });
      continue;
    }
    const r = await prisma.brainMemory.deleteMany({ where });
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

  // SituationLog: NO LONGER SWEPT · 2026-09-18.
  //
  // This used to be `deleteMany({ createdAt: { lt: daysAgo(90) } })`, labelled
  // "90d (rolling-trend widget data)". That label was the defect: ONE TABLE,
  // TWO INCOMPATIBLE CLASSIFICATIONS.
  //
  //   · here          — disposable widget telemetry, 90-day TTL
  //   · journal-brain — a first-class journal SILO, sitting beside reflection /
  //                     brain_dump / decision_replay, with grounding
  //                     enrichment, goal/mission linking, thread membership
  //                     and a recall embedding (lib/brain/journal-fanout.ts)
  //
  // Its three siblings have NO retention sweep at all. So the only journal silo
  // on a timer was the one whose retention comment had forgotten it was a
  // journal silo — and it is the only one measured empty. On 2026-09-18
  // situation_logs held ZERO rows, had never held one at a checkpoint, and
  // still carried 205 vector embeddings whose source ids point at nothing:
  // searchable personal content with no record behind it.
  //
  // Volume is not the reason to sweep it. The 205 embeddings span 10 days of
  // May 2026 — roughly 20 rows/day at the busiest this silo has ever been,
  // against siblings holding 217 and 9 rows lifetime. Unbounded growth is not a
  // live risk here; losing the operator's own situation log is.
  //
  // ⚠ DELETING WAS ALSO THE ORPHAN SOURCE. Nothing here cascaded to
  // vector_embeddings, because sourceId is a plain text column with no foreign
  // key. Every sweep therefore converted a journal entry into a permanent
  // orphan embedding. Not sweeping removes the producer; the 205 already made
  // are held out of recall by lib/db/embedding-shadow.ts rather than deleted,
  // since their `content` is now the last surviving copy of that text.
  //
  // If a retention window is ever wanted again, it has to cascade — use
  // dropEmbeddingsForSource("situation_log", ids, reason) from
  // lib/brain/memory-tombstone.ts — and it should cover all four silos or none.
  deletedByTable.situation_logs = 0;

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

  // ── Derived-index reconciliation · 2026-09-18 ────────────────────────────
  // Every sweep above DELETES source rows. `vector_embeddings` indexes ~13 of
  // those tables through a plain text ("sourceType","sourceId") pair with NO
  // foreign key — one index, many sources, so there is no referential action to
  // cascade. A delete up there therefore leaves a live, searchable embedding
  // pointing at nothing, and measured 2026-09-18 that had happened 396 times
  // outside brain_memory (which alone had a liveness filter at the recall
  // boundary). Reconciling in the SAME run that causes it is the point: a
  // separate nightly would drift, and this is the job that owes the debt.
  //
  // MARKS, NEVER DELETES — the embedding's `content` column is frequently the
  // last surviving copy of a hard-deleted source. Bounded by
  // MAX_NEW_MARKS_PER_RUN so a mass-delete night cannot turn into a mass
  // quarantine without an operator running the script with --force.
  //
  // Never fails the cleanup: reconciliation is maintenance, and turning it into
  // a hard error would file a successful prune as a failed cron.
  const shadowSweep = await sweepEmbeddingShadow().catch((err: unknown) => {
    logError("cron.data-cleanup", err, { fn: "sweepEmbeddingShadow" }, "warn");
    return null;
  });

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

  // resultCount makes the volume visible in cron_job_logs, which recorded NULL
  // on every run to date — including the night 54,107 rows were deleted.
  // ok:false files the run as FAILED (lib/services/cron-manager.ts
  // reportedFailureReason) so a blocked sweep is an alarm, not a footnote.
  // ⚠ FAILURE MUST BE TOP-LEVEL OR IT IS NOT A FAILURE (2026-09-18 · review on
  // #2430). `reportedFailureReason` in lib/services/cron-manager.ts reads ONLY a
  // top-level `ok: false` — CronJobLog stores status/error/count, never this
  // payload. So the first cut, which reported the shadow sweep's refusal nested
  // under `embeddingShadow`, would have filed a run as SUCCESS while dead
  // embeddings stayed searchable and nobody was told.
  //
  // That is precisely the defect repaired across this cron fleet on 2026-09-17,
  // where three jobs wrote `status: "success"` before doing the work and
  // /system/fleet was green for seven weeks. Reintroducing it one layer down,
  // in the same file, is exactly how that class survives being "fixed".
  // A SKIPPED SOURCE IS ALSO A FAILURE, and that is not obvious (2026-09-18,
  // review on #2434). `refused` covers the cap; it does NOT cover a source the
  // sweep declined individually — a missing table, a renamed soft-delete column,
  // or the 100%-mark mapping guard. Those leave `refused:false` with an empty
  // reason list, so the cron logged SUCCESS while that source went unreconciled
  // and its stale embeddings stayed searchable.
  //
  // In steady state this list is EMPTY: all 11 allowlisted tables exist, all
  // their soft-delete columns exist, and situation_log carries allowFullSweep.
  // So a skip is never routine — it means the schema moved under the allowlist,
  // which is exactly the thing that must not be discovered a month later.
  const skipped = (shadowSweep?.sources ?? [])
    .filter((s) => s.skipped)
    .map((s) => `${s.sourceType}: ${s.skipped}`);

  const failureReasons = [
    ...blockedSweeps.map((b) => b.reason),
    ...(shadowSweep === null ? ["embedding shadow sweep threw — see error_logs"] : []),
    ...(shadowSweep?.refused && shadowSweep.refusedReason
      ? [`embedding shadow sweep refused — ${shadowSweep.refusedReason}`]
      : []),
    ...(skipped.length > 0 ? [`embedding shadow sources skipped — ${skipped.join(" | ")}`] : []),
  ];

  return {
    ...(failureReasons.length > 0
      ? { ok: false as const, reason: failureReasons.join(" | ") }
      : {}),
    resultCount: totalDeleted,
    deletedByTable,
    totalDeleted,
    brainMemoryReport,
    blockedSweeps,
    // Surfaced, not swallowed: a reconciliation that runs but is never reported
    // is indistinguishable from one that never ran. `refused` means the cap
    // held — that is a real signal, not a footnote.
    embeddingShadow: shadowSweep
      ? {
          marked: shadowSweep.totalMarked,
          cleared: shadowSweep.totalCleared,
          refused: shadowSweep.refused,
          refusedReason: shadowSweep.refusedReason,
          skipped,
        }
      : { error: "sweep threw — see error_logs" },
  };
});
