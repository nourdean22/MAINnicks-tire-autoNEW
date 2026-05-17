/**
 * GET /api/brain/tools — tool telemetry surface.
 *
 * Returns aggregated per-tool stats (totalCalls, successRate,
 * avgDurationMs, failCount, lastErrors) collected by tool-telemetry.ts
 * from every chat turn. Feeds the /brain dashboard's Tools section
 * so Nour can see which tools pull weight + which are failing.
 *
 * No params — always returns the full list sorted by totalCalls desc.
 * Owner-auth.
 */

import { apiHandler } from "@/lib/utils/http";
import { getToolStats, getProblemTools } from "@/lib/ai/tool-telemetry";

export const GET = apiHandler(
  async () => {
    const [stats, problem] = await Promise.all([
      getToolStats(100),
      getProblemTools(),
    ]);
    return {
      ok: true,
      total: stats.length,
      problem,         // names of tools with <50% success + ≥10 calls
      stats,
    };
  },
  { auth: "owner" },
);
