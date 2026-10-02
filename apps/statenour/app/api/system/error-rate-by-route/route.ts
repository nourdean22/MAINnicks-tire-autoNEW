/**
 * GET /api/system/error-rate-by-route · v10.0.89 · 2026-05-02.
 *
 * Per-route reliability over a window (traffic + error rate + latency, scored
 * "fix-first"). Since 2026-10-02 this route is a thin REST face over the ONE
 * implementation, `buildErrorRateByRoute` (lib/services/system-data.ts), which
 * the tRPC procedure `system.errorRateByRoute` and the /system/health card
 * also read. The copy of the SQL that lived here bound its window as text and
 * failed every call with SQLSTATE 42883 — the same defect the service had;
 * one owner means one fix.
 *
 * Query params:
 *   · range = '1h' | '24h' | '7d' (default 24h)
 *   · minRequests = 5 (skip low-traffic noise)
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildErrorRateByRoute } from "@/lib/services/system-data";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const range = url.searchParams.get("range") ?? "24h";
    const minRequests = Math.max(
      1,
      parseInt(url.searchParams.get("minRequests") ?? "5", 10) || 5,
    );
    return buildErrorRateByRoute(range, minRequests);
  },
  { auth: "owner" },
);
