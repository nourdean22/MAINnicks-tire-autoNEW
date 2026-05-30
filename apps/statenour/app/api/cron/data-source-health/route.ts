/**
 * GET /api/cron/data-source-health · 2026-05-29
 *
 * Runs the data-source canary probes (lib/contracts/data-source-health.ts)
 * and persists one BrainMemory(category="data_source_probe") row per probe
 * per ET-day. The /system/health operational rollup + /system/data-source-
 * probes surface read these rows.
 *
 * WHY THIS EXISTS: the probe pipeline + reader were built in v10.0.58
 * (Wave B) — but this cron route was never created and never registered,
 * so the canary that should catch a dead bridge / $0-revenue feeder ran
 * ZERO times. That's why nothing screamed when the nickstire bridge went
 * unreachable and revenue silently read $0. Now wired.
 */
import { cronHandler } from "@/lib/utils/http";
import { runHealthProbes } from "@/lib/contracts/data-source-health";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const result = await runHealthProbes();
  return {
    status: result.failed > 0 ? "degraded" : "ok",
    total: result.total,
    ok: result.ok,
    failed: result.failed,
    empty: result.empty,
  };
});
