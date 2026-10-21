/**
 * Nick AI Agent — Chat/communication handlers: social, media, reviews, memory.
 * Handles: socialPost, socialStatus, reviewContent, sendMedia, remember, memories,
 *          cameraFeed, cameras, setCamera, shopPulse, shopDriverStatus,
 *          schedulerStatus, triggerPrerender, syncShopDriver, customerIntelligence
 */

// ─── Shop Pulse ───────────────────────────────────────

export async function handleShopPulse() {
  // 2026-05-05 — when Nick chat asks for the shop pulse (revenue today,
  // jobs closed, walk rate), fire a demand-driven ALG probe so Nick
  // answers with FRESH data, not cached. Probe budget dedups across
  // multiple chat queries within 30s.
  // Fire-and-forget — don't block the response on it. If probe takes
  // 8s and chat is impatient, the next query gets the fresh numbers.
  import("../../services/algProbeBudget").then(({ requestAlgProbe }) =>
    requestAlgProbe("chat_query", { detail: "shop_pulse" }),
  ).catch(() => { /* probe is fire-and-forget */ });

  const { getShopPulse } = await import("../../services/nickIntelligence");
  return getShopPulse();
}

// ─── Cron Health (read-only · last 24h of cron_log) ───
// wave-149 · the operator had NO UI to see which of ~40 crons ran / failed /
// silently skipped — the exact blind spot that hid the never-scheduled
// follow-up-cadence cron this session. Reads the existing cron_log table
// (failed jobs put their error in `details`). No schema change.
export async function handleCronHealth() {
  const { getDb } = await import("../../db");
  const { cronLog } = await import("../../../drizzle/schema");
  const { desc, gte } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return db.select({
    jobName: cronLog.jobName,
    status: cronLog.status,
    durationMs: cronLog.durationMs,
    recordsProcessed: cronLog.recordsProcessed,
    details: cronLog.details,
    startedAt: cronLog.startedAt,
    completedAt: cronLog.completedAt,
  }).from(cronLog).where(gte(cronLog.startedAt, since)).orderBy(desc(cronLog.startedAt)).limit(500);
}
