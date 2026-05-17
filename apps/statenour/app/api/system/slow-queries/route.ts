/**
 * GET /api/system/slow-queries · v10.0.18 · Apr 30 (Horizon 5).
 *
 * Top-N slowest Prisma query shapes seen in the current process.
 * Owner-gated. Read-only.
 *
 * Caveat: each Vercel lambda has its own buffer — a "fresh" cold
 * start returns an empty buffer. The accompanying dashboard
 * surfaces this so the operator doesn't misinterpret silence as
 * "everything's fast."
 */

import { apiHandler } from "@/lib/utils/http";
import {
  getTopSlowQueries,
  getSlowQueryStats,
} from "@/lib/db/slow-query-tracker";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "10", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(limitParam, 50))
      : 10;

    const stats = getSlowQueryStats();
    const top = getTopSlowQueries(limit);

    return {
      generatedAt: new Date().toISOString(),
      processStartedHint:
        "buffer is per-lambda; cold starts reset it. Run a workload through the dashboard, then refresh.",
      stats,
      top: top.map((q) => ({
        ...q,
        lastSeenAt: new Date(q.lastSeenAt).toISOString(),
      })),
    };
  },
  { auth: "owner" }, // v9.1.14 sensitive-GET gate
);
