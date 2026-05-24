/**
 * Cron · Psychographic Profile Refresh
 *
 * Daily classifier that recomputes customers.psycho_profile across the
 * entire customer table (~2,800 rows). Writes back to customers.psycho_*
 * columns when the segment changes (idempotent · no DB churn on stable
 * customers).
 *
 * Output: count by segment + delta vs yesterday for the Telegram alert.
 * Threshold for alert: silent on no-changes runs · alert when >25 customers
 * change segments in one day (= signal of something real).
 *
 * Wave-181.111.
 */

import { sendTelegram } from "../../services/telegram";
import { classifyAllCustomers } from "../../services/customerPsychoProfile";
import { createLogger } from "../../lib/logger";

const log = createLogger("cron:psycho-profile");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

const ALERT_THRESHOLD_CHANGED = 25;

export async function processPsychoProfileRefresh(): Promise<ProcessResult> {
  const start = Date.now();
  log.info("[psycho-profile] refresh start");

  let result: Awaited<ReturnType<typeof classifyAllCustomers>>;
  try {
    result = await classifyAllCustomers();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("[psycho-profile] classifier crashed", { error: msg });
    try {
      await sendTelegram(`❌ PSYCHO PROFILE CRON FAILED · ${msg.slice(0, 200)}`);
    } catch { /* swallow */ }
    return { recordsProcessed: 0, details: `crashed: ${msg.slice(0, 100)}` };
  }

  const durMs = Date.now() - start;
  log.info(`[psycho-profile] done in ${durMs}ms`, result);

  // Telegram alert on meaningful change · silent on stable runs
  if (result.updated >= ALERT_THRESHOLD_CHANGED) {
    try {
      const sortedSegments = Object.entries(result.segmentCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([segment, count]) => `${segment}: ${count}`)
        .join(" · ");
      await sendTelegram(
        `📊 PSYCHO PROFILE REFRESH · ${result.processed} customers classified ` +
          `(${result.updated} changed segments, ${result.unchanged} stable). ` +
          `Distribution: ${sortedSegments}` +
          (result.errored > 0 ? ` ⚠️ ${result.errored} row errors — see logs.` : ""),
      );
    } catch (e) {
      log.warn("[psycho-profile] telegram notify failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    recordsProcessed: result.processed,
    details: `processed=${result.processed} updated=${result.updated} unchanged=${result.unchanged} errored=${result.errored} ` +
      `top3=${Object.entries(result.segmentCounts).sort(([, a], [, b]) => b - a).slice(0, 3).map(([s, c]) => `${s}:${c}`).join(",")}`,
  };
}
