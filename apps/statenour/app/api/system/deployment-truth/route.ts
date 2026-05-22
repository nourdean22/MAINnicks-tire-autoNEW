/**
 * GET /api/system/deployment-truth · v10 Track E.4 · Apr 30.
 *
 * One panel answering:
 *   "Is the deployed code, the live schema, and the env config
 *    actually in agreement right now?"
 *
 * Aggregates: build identity · schema drift · env-secret presence ·
 * NICK Prime prompt mode · 24h cron health.
 *
 * Owner-gated. Cached 30s — composes 3 separate DB reads.
 *
 * Phase B.7a (2026-05-22) · the agreement-check assembly moved to the
 * shared `system-pages.buildDeploymentTruth` service so the legacy REST
 * consumer AND the new `system.deploymentTruth` tRPC procedure can't
 * drift. The 30s cache now lives inside the service. This route stays
 * mounted as the coexistence / rollback path.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildDeploymentTruth } from "@/lib/services/system-pages";

export const GET = apiHandler(
  async () => buildDeploymentTruth(),
  { auth: "owner" }, // sensitive — exposes build SHA + env presence + drift
);
