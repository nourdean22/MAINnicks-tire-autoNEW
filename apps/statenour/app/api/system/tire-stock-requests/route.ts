/**
 * GET /api/system/tire-stock-requests — used-tire stock-check log.
 *
 * v10.0.279 · reads brainMemory rows where category='tire_stock_request'
 * (written by /api/vapi/check-used-tire-stock when a caller asks if we
 * have a specific used tire in stock). Aggregates ·
 *   · total requests in window
 *   · top-asked sizes (inventory signal · what to stock more of)
 *   · urgency mix (broken-down vs casual)
 *   · most-recent N requests (call-by-call detail)
 *
 * Window query · ?days=N (1 / 7 / 30 / 90 · default 30).
 * Auth · owner.
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · the aggregation logic moved to the shared
 * `lib/services/system-pages-b.buildTireStockRequests` service · this
 * route AND the new `trpc.system.tireStockRequests` procedure call the
 * same function · drift impossible. The route stays mounted as the
 * rollback path.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildTireStockRequests } from "@/lib/services/system-pages-b";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") ?? "30", 10) || 30;
  return buildTireStockRequests({ days });
}, { auth: "owner" });
