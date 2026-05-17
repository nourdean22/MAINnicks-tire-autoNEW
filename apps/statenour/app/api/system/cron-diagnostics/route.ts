/**
 * GET /api/system/cron-diagnostics  ·  owner-auth
 *
 * Thin wrapper around lib/system/cron-diagnostics.ts. All analysis
 * logic lives in that module so the route + the local diagnostic
 * script stay in lock-step without copy-paste drift.
 *
 * Returns a CronHealthReport:
 *   · summary        - boolean + counter rollup
 *   · diagnoses      - prioritized diagnosis cards (critical first)
 *   · jobSummaries   - per-job success/fail + latest timestamps
 *   · silentDeclaredCrons - manifest names with zero log activity
 *   · killedIndividually  - per-cron kill switches that are flipped
 */

import { apiHandler } from "@/lib/utils/http";
import { scanCronHealth } from "@/lib/system/cron-diagnostics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = apiHandler(async () => scanCronHealth(), { auth: "owner" });
