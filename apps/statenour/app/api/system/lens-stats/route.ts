/**
 * GET /api/system/lens-stats — strategic-frameworks lens-firing aggregates.
 *
 * Phase U.3 (2026-05-18 PM) · the heavy lifting now lives in
 * `lib/services/lens-stats.ts` so the new tRPC procedure
 * `trpc.system.lensStats` calls the same function · drift between
 * the two consumers is structurally impossible. This endpoint stays
 * mounted for back-compat with any non-tRPC consumer.
 *
 * Query params · ?days=7 · window length (default 7, max 90)
 * Auth · owner.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildLensStats } from "@/lib/services/lens-stats";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") ?? "7", 10) || 7;
  return buildLensStats({ days });
}, { auth: "owner" });
