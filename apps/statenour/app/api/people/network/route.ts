/**
 * GET /api/people/network · 2026-05-27 · Power Atlas Phase 3
 *
 * Returns the operator's people-network snapshot · nodes + co-mention
 * edges. Backed by buildNetwork() in lib/brain/network-analysis.ts.
 * Consumed by the /relationships/network page.
 *
 * No cache · the graph is cheap to compute (<500 nodes typical) and
 * the operator's network changes too slowly for caching to help here.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildNetwork } from "@/lib/brain/network-analysis";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    const snapshot = await buildNetwork();
    return { ...snapshot, generatedAt: new Date().toISOString() };
  },
  { auth: "owner" },
);
