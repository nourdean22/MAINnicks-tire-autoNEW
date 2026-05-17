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

  log.info("Cleanup completed", { cleaned });
  return { recordsProcessed: cleaned, details: `Cleaned ${cleaned} stale entries` };
}
