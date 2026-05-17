/**
 * GET /api/cron/pattern-cluster · Wave 23 (v10.0.529.79) · #2
 *
 * Nightly · runs the pattern-clusterer over the last 7 days of
 * BrainMemory(task_insight) rows. Persists patterns as BrainMemory
 * (task_pattern) so /brain's PatternCard reads them fast without
 * running clustering on every page load.
 *
 * Folded into mega-evening.
 */

import { apiHandler } from "@/lib/utils/http";
import { runPatternClustering } from "@/lib/services/pattern-clusterer";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    const result = await runPatternClustering();
    return { ok: true, ...result };
  },
  { auth: "cron" },
);
