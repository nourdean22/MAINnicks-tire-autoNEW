/**
 * GET /api/system/cron-runs/[jobName] · v8.14 · Apr 29.
 *
 * Per-job run history. Returns the last N rows from cron_job_logs
 * with status, duration, error preview, and a computed success-rate
 * + median duration over the requested window.
 *
 * Drives /system/cron-runs/[jobName] drill-down page. Composes on the
 * v6 cron_job_logs schema — no new tables.
 *
 * Phase B.7a (2026-05-22) · the history assembly moved to the shared
 * `system-pages.buildCronRunHistory` service so the legacy REST
 * consumer AND the new `system.cronRunHistory` tRPC procedure can't
 * drift. This route stays mounted as the coexistence / rollback path.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildCronRunHistory } from "@/lib/services/system-pages";

export const GET = apiHandler(async (req, ctx) => {
  const params = ctx.params
    ? ((await ctx.params) as { jobName: string })
    : { jobName: "" };
  const url = new URL(req.url);
  return buildCronRunHistory({
    jobName: params.jobName,
    sinceDays: Number(url.searchParams.get("sinceDays")) || undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts
