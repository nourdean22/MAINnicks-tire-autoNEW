import { NextRequest, NextResponse } from "next/server";
import { getRevenueStats } from "@/lib/services/business-intel";
import { requireSession } from "@/lib/auth-guard";

// v10.0.44 — auth gate. Pre-fix any caller could pull business
// revenue rollups for any period. Financial data must be owner-only.
export async function GET(req: NextRequest) {
  await requireSession(req);
  const period = (new URL(req.url).searchParams.get("period") || "month") as "day" | "week" | "month" | "year";
  const stats = await getRevenueStats(period);
  return NextResponse.json(stats);
}
