/**
 * GET /api/system/vapi-calls — VAPI call analytics for Nick's Tire.
 *
 * v10.0.269 · proxies VAPI's /call list endpoint with aggregations
 * so the /system/vapi-calls dashboard shows ·
 *   · total calls in the window
 *   · breakdown by status / endedReason
 *   · average duration
 *   · most-recent call
 *
 * Query params ·
 *   ?days=7   · window length (default 7, max 90)
 *
 * Auth · owner. VAPI key stays server-side · never exposed to client.
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · the aggregation logic moved to the shared
 * `lib/services/system-pages-b.buildVapiCallStats` service · this route
 * AND the new `trpc.system.vapiCalls` procedure call the same function
 * · drift impossible. The route stays mounted as the rollback path.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildVapiCallStats } from "@/lib/services/system-pages-b";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") ?? "7", 10) || 7;
  return buildVapiCallStats({ days });
}, { auth: "owner" });
