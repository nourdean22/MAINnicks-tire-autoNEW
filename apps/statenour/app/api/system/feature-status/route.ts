/**
 * GET /api/system/feature-status · v10.0.93 · 2026-05-02.
 *
 * Honest status registry of every recently-shipped feature.
 * Surfaces which are LIVE, DORMANT (need data), or PARTIAL.
 *
 * Course-correction artifact: after a multi-feature ship wave,
 * an audit caught that ~30% of new endpoints were dormant
 * scaffolding. This route makes the gap visible so future
 * Settings UI can render activation hints instead of empty
 * dashboards.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { FEATURE_REGISTRY, summarize } from "@/lib/system/feature-status";

export const GET = apiHandler(
  async () => {
    return {
      generatedAt: new Date().toISOString(),
      summary: summarize(),
      features: FEATURE_REGISTRY,
    };
  },
  { auth: "owner" },
);
