/**
 * Cron: Data Cleanup — Remove old analytics, expired specials, old job queue entries
 */
import { createLogger } from "../../lib/logger";
const log = createLogger("cron:cleanup");

export async function cleanupOldData(): Promise<{ recordsProcessed: number; details: string }> {
  let cleaned = 0;

  // Clean job queue
  try {
    const { jobQueue } = await import("../../lib/jobQueue");
    cleaned += jobQueue.cleanup(24 * 60 * 60 * 1000); // 24 hours
  } catch {}

  // Clean memory cache
  try {
    const { cleanupMemCache } = await import("../../lib/cache");
    cleaned += cleanupMemCache();
  } catch {}

  log.info("Cleanup completed", { cleaned });
  return { recordsProcessed: cleaned, details: `Cleaned ${cleaned} stale entries` };
}
