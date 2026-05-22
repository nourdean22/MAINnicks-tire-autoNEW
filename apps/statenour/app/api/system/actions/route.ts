import { apiHandler } from "@/lib/utils/http";
import { buildAutonomousActionsFeed } from "@/lib/services/system-pages";

/**
 * GET /api/system/actions — Nick's autonomous action audit feed.
 *
 * Returns recent actions grouped by rule + latest 100 individual rows.
 * Powers /system/actions — every autonomous Nick decision lives here.
 *
 * Query:
 *   ?rule=X          → filter to a specific ruleName
 *   ?since=7d|30d    → window (default 7d)
 *   ?approval=auto|pending|approved|rejected (filter)
 *
 * Phase B.7a (2026-05-22) · the feed assembly moved to the shared
 * `system-pages.buildAutonomousActionsFeed` service so the legacy REST
 * consumer AND the new `system.autonomousActions` tRPC procedure can't
 * drift. This route stays mounted as the coexistence / rollback path.
 */
export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    return buildAutonomousActionsFeed({
      since: url.searchParams.get("since") ?? undefined,
      rule: url.searchParams.get("rule") ?? undefined,
      approval: url.searchParams.get("approval") ?? undefined,
    });
  },
  { auth: "owner" },
); // v9.1.17 · added by add-get-route-auth.ts
