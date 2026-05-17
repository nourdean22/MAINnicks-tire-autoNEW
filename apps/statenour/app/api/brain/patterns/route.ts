/**
 * GET /api/brain/patterns · Wave 23 (v10.0.529.79) · #2
 *
 * Returns the current task-pattern clusters from BrainMemory · feeds
 * <PatternCard> on /brain and /trends. Cluster generation runs via
 * the nightly mega-evening cron + on-demand POST.
 *
 * POST regenerates the clusters on demand · used by the operator's
 * "refresh" button on the panel or by the cron job.
 */

import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { loadCurrentPatterns, runPatternClustering } from "@/lib/services/pattern-clusterer";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    const patterns = await loadCurrentPatterns();
    return { patterns };
  },
  { auth: "owner" },
);

export const POST = apiHandler(
  async (req) => {
    void (await readRequestJson(req).catch(() => ({})));
    const result = await runPatternClustering();
    return result;
  },
  { auth: "owner" },
);
