import { apiHandler } from "@/lib/utils/http";
import { checkDbConnection } from "@/lib/prisma";
import { getWorkerFreshness } from "@/lib/observability/worker-freshness";

/**
 * GET /api/system/heartbeat — Uptime monitor endpoint
 * Returns 200 if healthy, 503 if degraded.
 * Designed for external monitors (UptimeRobot, etc.)
 *
 * // public: external uptime monitors hit this without a session.
 * Returns only coarse liveness: web/db + private-worker freshness.
 * No operator-private data, job inventory, secrets, or payloads.
 */
export const GET = apiHandler(async () => {
  const db = await checkDbConnection();

  if (!db.connected) {
    return new Response(
      JSON.stringify({ status: "degraded", db: false }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const worker = await getWorkerFreshness();
  return {
    status: "ok",
    db_latency_ms: db.latency_ms,
    worker: {
      status: worker.status,
      age_minutes: worker.ageMinutes,
    },
  };
});
