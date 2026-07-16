/**
 * GET /api/brain/insights · v10.0.218 · narrative ribbon.
 *
 * Cross-system PATTERN signals (week-over-week trends), distinct
 * from /api/brain/nudges which surfaces actionable now-deltas.
 *
 * Thin legacy-REST wrapper: the entire query/shaping block lives in
 * buildBrainInsights() (lib/services/brain-insights.ts), shared with
 * the `brain.insightsRibbon` tRPC procedure. This file used to carry
 * a copy-pasted duplicate of that block — which drifted (the service
 * gained `deletedAt` filters the copy never did). Delegation makes
 * the drift structurally impossible.
 *
 * Auth: owner only.
 */
import { apiHandler } from "@/lib/utils/http";
import { buildBrainInsights } from "@/lib/services/brain-insights";

export const GET = apiHandler(async () => buildBrainInsights(), {
  auth: "owner",
});
