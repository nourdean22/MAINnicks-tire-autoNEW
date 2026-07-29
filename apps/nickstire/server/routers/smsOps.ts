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

    // 0105: creation→dispatch latency over rows the drain actually stamped.
    // Pre-0105 (unknown column) this stays honestly unmeasurable.
    let queueToSent:
      | { measurable: true; dispatchedCount: number; avgSeconds: number | null; maxSeconds: number | null; basis: string }
      | { measurable: false; why: string } = {
      measurable: false,
      why: "sms_messages.sent_at absent — apply migration 0105 (apply-sms-sent-at.ts) to enable this metric.",
    };
    try {
      const [qRows] = await db.execute(sql`
        SELECT COUNT(*) AS n,
               AVG(TIMESTAMPDIFF(SECOND, createdAt, sent_at)) AS avgSec,
               MAX(TIMESTAMPDIFF(SECOND, createdAt, sent_at)) AS maxSec
        FROM sms_messages
        WHERE direction = 'outbound' AND sent_at IS NOT NULL
          AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      `);
      const q = (Array.isArray(qRows) ? qRows[0] : undefined) as
        | { n?: unknown; avgSec?: unknown; maxSec?: unknown }
        | undefined;
      queueToSent = {
        measurable: true,
        dispatchedCount: Number(q?.n ?? 0),
        avgSeconds: q?.avgSec == null ? null : Math.round(Number(q.avgSec)),
        maxSeconds: q?.maxSec == null ? null : Number(q.maxSec),
        basis: "queued-row createdAt → drain-stamped sent_at (7d; held rows only — instant sends carry no queue latency)",
      };
    } catch {
      // keep the unmeasurable truth
    }

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
      queueToSent,
    };
  }),

  /**
   * Replay a failed/dead-lettered outbound row (Autopilot Wave 1).
   * Idempotent by construction: the UPDATE claims `failed → queued`
   * atomically, so a double-tap (or two admins) affects 0 rows the second
   * time and reports replayed:false. Attempts reset so the bounded-retry
   * cycle starts fresh; continuous rehydration delivers it within ~1 min
   * (subject to quiet hours / gateway / pause — the normal machinery).
   * Admin-only. Audit-logged.
   */
  replayFailed: adminProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      let result;
      try {
        result = await db.execute(sql`
          UPDATE sms_messages
          SET status = 'queued', send_attempts = 0, failure_reason = NULL
          WHERE id = ${input.messageId} AND status = 'failed' AND direction = 'outbound'
        `);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/unknown column|1054/i.test(msg)) throw err;
        // pre-0104: replay without the attempt-reset columns
        result = await db.execute(sql`
          UPDATE sms_messages
          SET status = 'queued'
          WHERE id = ${input.messageId} AND status = 'failed' AND direction = 'outbound'
        `);
      }
      const raw = (Array.isArray(result) && result[0] && typeof result[0] === "object"
        ? result[0]
        : result) as { affectedRows?: number };
      const replayed = (raw.affectedRows ?? 0) >= 1;
      if (replayed) {
        try {
          const { logAdminAction } = await import("../services/auditTrail");
          await logAdminAction({
            action: "sms.replay_failed",
            entityType: "sms_message",
            entityId: input.messageId,
            details: "Replayed failed outbound SMS (failed → queued, attempts reset)",
            actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
          });
        } catch { /* audit must never block the replay */ }
      }
      return { ok: true, replayed };
    }),

  /**
   * Hand a conversation back to the AI early (Autopilot Wave 6). The
   * 60-min takeover hold self-expires; this ends it NOW — the blueprint's
   * "unless the employee releases it", finally real. Writes the release
   * audit row humanTakeover.ts reads; a manual reply AFTER the release
   * re-arms the hold (most-recent signal wins). Idempotent by semantics
   * (releasing an unheld thread is a harmless no-op row).
   */
  releaseTakeover: adminProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      // Direct fail-LOUD insert (not logAdminAction, which swallows errors
      // by design): here the audit row IS the release mechanism — a
      // swallowed write would report "released" while the hold persists.
      const { getDb } = await import("../db");
      const { auditLog } = await import("../../drizzle/schema");
      const { randomUUID } = await import("crypto");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available — hold NOT released" });
      await db.insert(auditLog).values({
        id: randomUUID(),
        actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
        action: "customer.sms_takeover_released",
        entityType: "sms_conversation",
        entityId: String(input.conversationId),
        changes: { note: "Operator released the takeover hold — AI may auto-reply again on this thread" },
      });
      return { ok: true, conversationId: input.conversationId };
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
