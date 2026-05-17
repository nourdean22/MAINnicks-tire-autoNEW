/**
 * GET /api/system/repo-briefing · v10 Track E.3 · Apr 30.
 *
 * Owner-gated read of `getEcosystemDigest()` — weekly+30d commit
 * counts per monitored repo + Nick-readable narrative + flag list.
 *
 * Cached 5 min. GitHub rate limit budget: 6 monitored repos × 1
 * commits-list call = 6 calls per cache-miss · 12/hr at 5min ttl
 * — well under 5000/hr authenticated cap.
 */

import { apiHandler } from "@/lib/utils/http";
import { cached } from "@/lib/utils/cache";
import { getEcosystemDigest } from "@/lib/system/repo-briefing";

export const GET = apiHandler(
  async () => {
    return await cached("system_repo_briefing", 300, getEcosystemDigest);
  },
  { auth: "owner" }, // v9.1.14 sensitive-GET gate
);
