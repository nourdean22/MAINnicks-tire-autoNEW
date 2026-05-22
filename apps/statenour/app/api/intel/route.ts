/**
 * /api/intel — surfaced brain intel for the /intel page.
 *
 * v6 · BATCH 5 · Apr 28.
 * v7 cleanup · Apr 28. Stripped customer_stories + top_performers
 * (those were business — Nick's Tire customers + Meta IG insights —
 * and now live on nickstire). Personal-OS intel = automotive industry
 * trends only (public RSS feeds, informs Nour's strategic awareness).
 *
 * Auth: session.
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. Consumer reads
 * top-level `industry` key · returning raw NextResponse preserves
 * shape. Wrapper still provides rate-limit, auth, audit trace IDs.
 *
 * Cross-domain residuals slice (2026-05-22) · the recall moved to
 * `lib/services/industry-intel.getIndustryIntel` so this route AND the
 * `brain.industryIntel` tRPC procedure call the SAME function · drift
 * structurally impossible.
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/utils/http";
import { getIndustryIntel } from "@/lib/services/industry-intel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler(
  async () => {
    const view = await getIndustryIntel();
    return NextResponse.json(view);
  },
  { auth: "owner" },
);
