/**
 * SMS Ops router — the operator control surface the audit found missing
 * (2026-07-29, SMS Revenue Agent OS).
 *
 * One place answering: is the machine allowed to text? is the pipe up? what
 * is stuck? what did the AI do lately, and what did it refuse to do?
 *
 * Truth rules (adminTruth doctrine): a failed read returns `readable:false`
 * or throws so the client renders UNKNOWN — never a reassuring zero.
 * queue→sent latency is NOT reported: sms_messages carries no sent-at
 * timestamp, and a createdAt proxy would be a fabricated metric. Queue depth
 * + oldest-age are the live measurable signals.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";

export const smsOpsRouter = router({
  /** Everything on one read: pause, gateway, queue depth, caps, counters,
   *  autonomy ladder, recent suppressions, delivery failures, pending drafts. */
  opsStatus: adminProcedure.query(async () => {
    const { getSmsPauseState, checkGlobalDailyCap } = await import("../services/smsControl");
    const { getSmsStats, isShopGatewayConfigured, isShopGatewayReachable } = await import("../sms");
    const { summarizeAutonomy } = await import("../services/smsAutonomy");
    const { getRolloutMode } = await import("../services/smsOrchestrator");

    const [pause, cap] = await Promise.all([getSmsPauseState(), checkGlobalDailyCap()]);
    const stats = getSmsStats();
    const gatewayConfigured = isShopGatewayConfigured();
    const gatewayReachable = gatewayConfigured ? await isShopGatewayReachable() : null;

    // Durable queue truth from the DB (the in-memory gauge is per-pod).
    let queue: { queued: number; sending: number; oldestQueuedAgeMinutes: number | null; readable: boolean } = {
      queued: 0,
      sending: 0,
      oldestQueuedAgeMinutes: null,
      readable: false,
    };
    let suppressions7d: Array<{ status: string; statusReason: string | null; count: number }> = [];
    let deliveryFailures7d: number | null = null;
    let pendingDrafts: number | null = null;
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        const [qRows] = await db.execute(sql`
          SELECT
            SUM(status = 'queued') AS queued,
            SUM(status = 'sending') AS sending,
            TIMESTAMPDIFF(MINUTE, MIN(CASE WHEN status = 'queued' THEN createdAt END), NOW()) AS oldestMin
          FROM sms_messages
          WHERE direction = 'outbound' AND status IN ('queued', 'sending')
        `);
        const q = (Array.isArray(qRows) ? qRows[0] : undefined) as
          | { queued?: unknown; sending?: unknown; oldestMin?: unknown }
          | undefined;
        queue = {
          queued: Number(q?.queued ?? 0),
          sending: Number(q?.sending ?? 0),
          oldestQueuedAgeMinutes: q?.oldestMin == null ? null : Number(q.oldestMin),
          readable: true,
        };

        const [sRows] = await db.execute(sql`
          SELECT status, statusReason, COUNT(*) AS count
          FROM sms_orchestrations
          WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND status IN ('blocked', 'skipped', 'drafted')
          GROUP BY status, statusReason
          ORDER BY count DESC
          LIMIT 12
        `);
        suppressions7d = (Array.isArray(sRows) ? sRows : []).map((r) => {
          const row = r as { status?: unknown; statusReason?: unknown; count?: unknown };
          return {
            status: String(row.status ?? "unknown"),
            statusReason: row.statusReason == null ? null : String(row.statusReason),
            count: Number(row.count ?? 0),
          };
        });

        const [fRows] = await db.execute(sql`
          SELECT COUNT(*) AS n FROM sms_messages
          WHERE direction = 'outbound' AND status = 'failed'
            AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);
        deliveryFailures7d = Number(((Array.isArray(fRows) ? fRows[0] : undefined) as { n?: unknown } | undefined)?.n ?? 0);

        const [dRows] = await db.execute(sql`
          SELECT COUNT(*) AS n FROM sms_orchestrations
          WHERE requiresHumanApproval = 1 AND status IN ('drafted', 'received')
        `);
        pendingDrafts = Number(((Array.isArray(dRows) ? dRows[0] : undefined) as { n?: unknown } | undefined)?.n ?? 0);
      }
    } catch {
      // leave the unknowns unknown — the client renders them as such
    }

    // Autonomy ladder + live rollout mode per orchestrated event type.
    const ladder = summarizeAutonomy();
    const orchestrated = ladder.filter((l) => l.path === "orchestrator");
    const rolloutModes: Record<string, string> = {};
    for (const entry of orchestrated) {
      try {
        rolloutModes[entry.key] = await getRolloutMode(entry.key);
      } catch {
        rolloutModes[entry.key] = "unknown";
      }
    }

    return {
      pause,
      globalCap: cap,
      gateway: {
        configured: gatewayConfigured,
        reachable: gatewayReachable, // null = not configured (dev)
      },
      queue,
      inMemory: {
        delayedQueueSize: stats.delayedQueueSize,
        blockedByPause: stats.blockedByPause,
        blockedByGlobalCap: stats.blockedByGlobalCap,
        blockedByTakeover: stats.blockedByTakeover,
        optOutCheckSkipped: stats.optOutCheckSkipped,
        totalOptedOut: stats.totalOptedOut,
        totalSent: stats.totalSent,
        totalFailed: stats.totalFailed,
      },
      autonomy: ladder.map((l) => ({
        ...l,
        rolloutMode: l.path === "orchestrator" ? (rolloutModes[l.key] ?? "unknown") : null,
      })),
      suppressions7d,
      deliveryFailures7d,
      pendingDrafts,
    };
  }),

  /**
   * Response-loop latency metrics — computed only from real timestamps:
   *   - lead → first contact (leads.createdAt → contactedAt, 30d)
   *   - inbound SMS → resolved obligation (sms_response_jobs createdAt →
   *     updatedAt on terminal 'responded', 7d; updatedAt is stamped by the
   *     terminal transition, labeled as such)
   * queue→sent is deliberately absent (no sent-at column — not measurable).
   */
  latencyMetrics: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const [leadRows] = await db.execute(sql`
      SELECT
        COUNT(*) AS contacted,
        AVG(TIMESTAMPDIFF(MINUTE, createdAt, contactedAt)) AS avgMin,
        MAX(TIMESTAMPDIFF(MINUTE, createdAt, contactedAt)) AS maxMin,
        SUM(TIMESTAMPDIFF(MINUTE, createdAt, contactedAt) <= 120) AS within2h
      FROM leads
      WHERE contactedAt IS NOT NULL
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND source != 'careers'
    `);
    const lead = (Array.isArray(leadRows) ? leadRows[0] : undefined) as
      | { contacted?: unknown; avgMin?: unknown; maxMin?: unknown; within2h?: unknown }
      | undefined;

    const [uncontactedRows] = await db.execute(sql`
      SELECT COUNT(*) AS n FROM leads
      WHERE contactedAt IS NULL AND contacted = 0 AND status = 'new'
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND source != 'careers'
    `);
    const uncontacted30d = Number(
      ((Array.isArray(uncontactedRows) ? uncontactedRows[0] : undefined) as { n?: unknown } | undefined)?.n ?? 0,
    );

    const [jobRows] = await db.execute(sql`
      SELECT
        COUNT(*) AS responded,
        AVG(TIMESTAMPDIFF(SECOND, createdAt, updatedAt)) AS avgSec,
        MAX(TIMESTAMPDIFF(SECOND, createdAt, updatedAt)) AS maxSec
      FROM sms_response_jobs
      WHERE status = 'responded'
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
    const job = (Array.isArray(jobRows) ? jobRows[0] : undefined) as
      | { responded?: unknown; avgSec?: unknown; maxSec?: unknown }
      | undefined;

    return {
      leadFirstContact30d: {
        contactedCount: Number(lead?.contacted ?? 0),
        avgMinutes: lead?.avgMin == null ? null : Math.round(Number(lead.avgMin)),
        maxMinutes: lead?.maxMin == null ? null : Number(lead.maxMin),
        within2hCount: Number(lead?.within2h ?? 0),
        uncontacted30d,
      },
      inboundResponse7d: {
        respondedCount: Number(job?.responded ?? 0),
        avgSeconds: job?.avgSec == null ? null : Math.round(Number(job.avgSec)),
        maxSeconds: job?.maxSec == null ? null : Number(job.maxSec),
        basis: "sms_response_jobs createdAt → terminal-update timestamp (responded only)",
      },
      queueToSent: {
        measurable: false,
        why: "sms_messages has no sent-at column; a createdAt proxy would fabricate the metric. Add a column migration before reporting this.",
      },
    };
  }),

  /**
   * Arm / lift the global SMS pause. Operator action from the admin UI
   * (two-tap confirmed client-side). Audit-logged. HOLD semantics — see
   * services/smsControl.ts.
   */
  setPause: adminProcedure
    .input(z.object({ paused: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { setFlag } = await import("../services/featureFlags");
      const { SMS_GLOBAL_PAUSE_FLAG, _resetPauseCacheForTest } = await import("../services/smsControl");
      await setFlag(SMS_GLOBAL_PAUSE_FLAG, input.paused);
      _resetPauseCacheForTest(); // take effect immediately, not at cache expiry
      try {
        const { logAdminAction } = await import("../services/auditTrail");
        await logAdminAction({
          action: "sms.global_pause",
          entityType: "feature_flag",
          entityId: SMS_GLOBAL_PAUSE_FLAG,
          details: input.paused ? "PAUSED all automated customer SMS (hold, not drop)" : "RESUMED automated customer SMS",
          newValue: String(input.paused),
          actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
        });
      } catch {
        // audit failure must not block the emergency stop itself
      }
      return { ok: true, paused: input.paused };
    }),
});
