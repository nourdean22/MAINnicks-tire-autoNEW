import { createLogger } from "../../lib/logger";
import { replenishReserve } from "../../services/contentManufacturing";

const log = createLogger("cron:content-reserve-replenish");

export async function runContentReserveReplenish(): Promise<{ recordsProcessed: number; details: string }> {
  log.info("Starting content reserve replenishment cron job");
  try {
    const result = await replenishReserve();
    return {
      recordsProcessed: result.draftsCreated,
      details: `success=${result.success} campaignRuns=${JSON.stringify(result.campaignRuns)}`
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Content reserve replenishment cron job failed:", err);
    return {
      recordsProcessed: 0,
      details: `error=${msg}`
    };
  }
}
