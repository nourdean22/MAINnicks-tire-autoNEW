/**
 * POST /api/settings/crons/trigger — manual fire a cron.
 * Body: { path: "/api/cron/<name>" | "/api/cron/mega?slot=morning" }
 *
 * Runs the cron via self-fetch with CRON_SECRET so the target route
 * accepts it as legit. Returns timing + status for UI toast feedback.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { triggerCronByPath } from "@/lib/services/cron-control";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// v10.0.119 audit-pattern fix · was unauthenticated. This route
// owns CRON_SECRET on the way out — any anonymous caller could
// trigger any cron via /api/cron/* path. DOS + cost-burn + AI-burn
// vector. Owner-gated now.
export const POST = apiHandler(async (req) => {
  const body = await readRequestJson<{ path?: string }>(req);
  if (!body.path || !body.path.startsWith("/api/cron/")) {
    throw new Error("Invalid cron path");
  }
  return triggerCronByPath(body.path);
}, { auth: "owner" });
