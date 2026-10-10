import { apiHandler } from "@/lib/utils/http";
import { checkDbConnection } from "@/lib/prisma";
import { getWorkerFreshness } from "@/lib/observability/worker-freshness";

/**
 * GET /api/system/heartbeat — Uptime monitor endpoint
 * Returns 503 when the DB is down. A worker that is not fresh (stale, or no
 * readable receipt) returns 200 with `status: "degraded"`: this path is also
 * Railway's deploy healthcheck (.railway/railway.ts) and the CI dev-server
 * probe, so a 503 for the worker would block deploying the fix it needs.
 * Monitors that page on the worker read `status` / `worker.status`.
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
    // 2026-10-10 · was a literal "ok": a dead worker paged nobody.
    status: worker.status === "fresh" ? "ok" : "degraded",
    db_latency_ms: db.latency_ms,
    worker: {
      status: worker.status,
      age_minutes: worker.ageMinutes,
    },
  };
});
