/**
 * /api/business/location-ranking · v10.0.526 · Arc C · Feature 7
 *
 * GET ?month=YYYY-MM · returns the persisted monthly ranking from
 *     BrainMemory(category="location_ranking", key="monthly_YYYY-MM").
 *     Omit `month` to get the current ET month.
 *
 * Read-only · owner-gated. The ranking is written by the monthly
 * cron (fold inside mega-evening · 1st-of-month) or by the test
 * harness calling persistRanking directly. This endpoint does NOT
 * re-rank · it surfaces what was already computed so the operator
 * can pull the same view in the dashboard and in chat.
 */

import { apiHandler } from "@/lib/utils/http";
import { etMonthKey, getPersistedRanking } from "@/lib/services/location-rank";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const monthParam = url.searchParams.get("month");
  const monthKey = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? monthParam
    : etMonthKey();

  const ranking = await getPersistedRanking(monthKey);
  return {
    ok: true,
    ...ranking,
  };
}, { auth: "owner" });
