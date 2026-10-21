/**
 * Cron: Data Cleanup — Remove old analytics, expired specials, old job queue entries, expired OTPs
 */
import { createLogger } from "../../lib/logger";
const log = createLogger("cron:cleanup");

export async function cleanupOldData(): Promise<{ recordsProcessed: number; details: string }> {
  let cleaned = 0;

  // Clean job queue
  try {
    const { jobQueue } = await import("../../lib/jobQueue");
    cleaned += jobQueue.cleanup(24 * 60 * 60 * 1000); // 24 hours
  } catch (err) {
    log.warn("Job queue cleanup failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Clean memory cache
  try {
    const { cleanupMemCache } = await import("../../lib/cache");
    cleaned += cleanupMemCache();
  } catch (err) {
    log.warn("Memory cache cleanup failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Clean expired OTP codes (older than 1 hour — they expire after 10 min, 1h is generous)
  try {
    const { getDb } = await import("../../db");
    const { otpCodes } = await import("../../../drizzle/schema");
    const { lt } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const cutoff = new Date(Date.now() - 60 * 60 * 1000);
      const result = await db.delete(otpCodes).where(lt(otpCodes.expiresAt, cutoff));
      const otpCleaned = (result as any)?.[0]?.affectedRows ?? 0;
      cleaned += otpCleaned;
    }
  } catch (err) {
    log.warn("OTP cleanup failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Clean old cron logs (older than 7 days)
  try {
    const { getDb } = await import("../../db");
    const { cronLog } = await import("../../../drizzle/schema");
    const { lt } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const result = await db.delete(cronLog).where(lt(cronLog.startedAt, cutoff));
      const cronCleaned = (result as any)?.[0]?.affectedRows ?? 0;
      cleaned += cronCleaned;
    }
  } catch (err) {
    log.warn("Cron log cleanup failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Wave-181.59: prune stale OTP brute-force counters.
  // Rows older than 2 hours with no active block are safe to delete —
  // the 15-min attempt window has long since rolled over, and any
  // 1-hour lockout has expired. Live blocks (blocked_until > now) are
  // left untouched so we never accidentally clear an active lockout.
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const [result] = await db.execute(sql`
        DELETE FROM otp_attempts
        WHERE updated_at < (NOW() - INTERVAL 2 HOUR)
          AND (blocked_until IS NULL OR blocked_until < NOW())
      `);
      const otpAttemptsCleaned = (result as { affectedRows?: number })?.affectedRows ?? 0;
      cleaned += otpAttemptsCleaned;
    }
  } catch (err) {
    log.warn("OTP attempts cleanup failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Wave-181.66: prune stale SMS daily rate-limit counters.
  // Rows older than 25 hours are safe to delete — the rolling 24h window
  // has rolled over, so a fresh send would start a new window anyway.
  // The extra hour of slack avoids deleting a row that's about to roll
  // over naturally on its next send (avoids a brief gap where an at-cap
  // phone could send one extra message because the row was just pruned).
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const [result] = await db.execute(sql`
        DELETE FROM sms_rate_limit
        WHERE updated_at < (NOW() - INTERVAL 25 HOUR)
      `);
      const smsRateLimitCleaned = (result as { affectedRows?: number })?.affectedRows ?? 0;
      cleaned += smsRateLimitCleaned;
    }
  } catch (err) {
    log.warn("SMS rate-limit cleanup failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // wave-181.77 (db-optimizer audit) · prune cron_alerts_fired.
  // Migration 0044 (wave-181.69) shipped the table + idx_cron_alerts_fired_fired_at
  // specifically for cleanup scans, but I forgot to add the cleanup
  // block — audit caught it. 90-day retention keeps recent history for
  // operator debugging without unbounded growth.
  // A once-per-state-for-good claim (sendOncePerStateEver, fired_for = EVER_FIRED_FOR) is the dedupe
  // marker itself, not history: pruning it would re-send an urgent-review alert that is still unanswered.
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const { EVER_FIRED_FOR } = await import("../../services/alertClaim");
    const db = await getDb();
    if (db) {
      const [result] = await db.execute(sql`
        DELETE FROM cron_alerts_fired WHERE fired_at < (NOW() - INTERVAL 90 DAY) AND fired_for <> ${EVER_FIRED_FOR}
      `);
      const cronAlertsCleaned = (result as { affectedRows?: number })?.affectedRows ?? 0;
      cleaned += cronAlertsCleaned;
    }
  } catch (err) {
    log.warn("cron_alerts_fired cleanup failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Q-12 phase 1 · bridge_outbox shadow rows (ADR-0019 §5.5) are a comparison
  // sample, never sent, and they copy the bus payload (names, phones). The
  // phase-1 window is 7 days; keep 14, then drop them. Only status='shadow':
  // a later phase's pending/dead rows are never pruned here.
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const { isMissingTableError } = await import("../../lib/dbErrors");
    const db = await getDb();
    if (db) {
      try {
        const [result] = await db.execute(sql`
          DELETE FROM bridge_outbox WHERE status = 'shadow' AND created_at < (NOW() - INTERVAL 14 DAY)
        `);
        cleaned += (result as { affectedRows?: number })?.affectedRows ?? 0;
      } catch (err) {
        if (!isMissingTableError(err)) throw err; // 0137 not applied yet: nothing to prune
      }
    }
  } catch (err) {
    log.warn("bridge_outbox shadow cleanup failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Q-12 phase 1c · ADR-0019 §9: while shadow rows are being recorded, log the
  // 7-day completeness totals (counts only) so the comparison is read, not just
  // written. Only while the flag is ON: off, there is nothing being compared,
  // and the admin query (nourOsBridge.outboxCompleteness) still answers on demand.
  try {
    const { isEnabled } = await import("../../services/featureFlags");
    const { bridgeOutboxCompleteness } = await import("../../services/bridgeOutboxCompleteness");
    const report = (await isEnabled("bridge_outbox_shadow"))
      ? await bridgeOutboxCompleteness({ windowDays: 7 })
      : null;
    if (report?.state === "measured") {
      log.info("bridge_outbox completeness", {
        windowDays: report.windowDays,
        shadowEnabled: report.shadowEnabled,
        ...report.totals,
        byFamily: Object.fromEntries(report.families.map((f) => [f.family, { source: f.source, missing: f.missing, extra: f.extra }])),
      });
    } else if (report?.state === "error") {
      log.warn("bridge_outbox completeness unavailable", { family: report.family });
    }
  } catch (err) {
    log.warn("bridge_outbox completeness failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // revenue_reconciliation_candidates is re-derived every 2 h and only the newest row per call is ever
  // read, so superseded copies pile up. Always report the counts (they land in cron_log via `details`);
  // delete them only while the revenue_recon_retention flag is ON. Unavailable is UNKNOWN, never zero.
  let reconSuffix = "recon candidates: unavailable";
  try {
    const { getDb } = await import("../../db");
    const db = await getDb();
    if (db) {
      const { reconCandidatesRetention, reconRetentionDetails, readRetentionFlagFresh, toDrizzleSql } = await import(
        "../../services/revenueReconciliationRetention"
      );
      // The delete path reads the flag row fresh and fails closed. It must NOT use featureFlags.isEnabled():
      // that cache swallows a failed refresh and returns the last value, so a stale ON would keep deleting.
      const query = (stmt: Parameters<typeof toDrizzleSql>[0]) => db.execute(toDrizzleSql(stmt));
      const recon = await reconCandidatesRetention({ query, isEnabled: () => readRetentionFlagFresh(query) });
      reconSuffix = reconRetentionDetails(recon);
      if (recon.state === "measured") cleaned += recon.deleted ?? 0;
    }
  } catch (err) {
    log.warn("recon candidates retention failed", { error: err instanceof Error ? err.message : String(err) });
  }

  log.info("Cleanup completed", { cleaned });
  return { recordsProcessed: cleaned, details: `Cleaned ${cleaned} stale entries; ${reconSuffix}` };
}
