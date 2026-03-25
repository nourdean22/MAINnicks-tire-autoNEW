/**
 * Cron: Retention Sequences — 90/180/365 day re-engagement
 * Sends SMS to customers who haven't visited in a while.
 */
import { createLogger } from "../../lib/logger";
const log = createLogger("cron:retention");

export async function processRetention90Day(): Promise<{ recordsProcessed: number }> {
  // TODO: Query customers where last_visit 88-92 days ago, not contacted in 30 days
  log.info("Retention 90-day check (feature flag controlled)");
  return { recordsProcessed: 0 };
}

export async function processRetention180Day(): Promise<{ recordsProcessed: number }> {
  log.info("Retention 180-day check (feature flag controlled)");
  return { recordsProcessed: 0 };
}

export async function processRetention365Day(): Promise<{ recordsProcessed: number }> {
  log.info("Retention 365-day check (feature flag controlled)");
  return { recordsProcessed: 0 };
}
