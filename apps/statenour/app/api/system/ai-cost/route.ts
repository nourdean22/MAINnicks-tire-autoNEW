/**
 * GET /api/system/ai-cost — cost + latency + volume feed.
 *
 * Phase Y.1 (2026-05-18 PM) · heavy lifting moved to
 * `lib/services/ai-cost.ts` so both this REST endpoint AND the
 * `trpc.system.aiCost` procedure call the same `buildAiCostFeed()`
 * function · drift between the two consumers is structurally
 * impossible.
 *
 * Stays mounted for back-compat with any non-tRPC consumer (cron
 * health-digest reads, external probes, ad-hoc curl).
 */

import { apiHandler } from "@/lib/utils/http";
import { buildAiCostFeed } from "@/lib/services/ai-cost";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => buildAiCostFeed(), { auth: "owner" });
