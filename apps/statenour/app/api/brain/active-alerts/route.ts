/**
 * GET /api/brain/active-alerts · v8.3 · Apr 29.
 *
 * Aggregates the recent BrainMemory alert categories that v8.2 added:
 *   · correlation_alert         (F2 cron output)
 *   · decision_quality_drift    (F3 cron output)
 *
 * Returns the last N alerts (default 10) per category, newest first,
 * with action context so the UI can render rich badges.
 *
 * Drives <ActiveAlertsCard /> on /brain.
 *
 * Phase B.6d (2026-05-22 · legacy-modernizer REST→tRPC brain slice) ·
 * the inline aggregation moved to `lib/services/brain-domain.buildActiveAlerts`
 * so this route AND the new `trpc.brain.activeAlerts` procedure call the
 * same function · drift impossible.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildActiveAlerts } from "@/lib/services/brain-domain";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit")) || 10, 1),
      50,
    );
    const sinceDays = Math.min(
      Math.max(Number(url.searchParams.get("sinceDays")) || 30, 1),
      180,
    );
    return buildActiveAlerts({ limit, sinceDays });
  },
  { auth: "owner" },
); // v9.1.17 · added by add-get-route-auth.ts
