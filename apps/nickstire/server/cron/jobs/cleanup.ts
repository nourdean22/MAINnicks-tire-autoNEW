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

  log.info("Cleanup completed", { cleaned });
  return { recordsProcessed: cleaned, details: `Cleaned ${cleaned} stale entries` };
}
