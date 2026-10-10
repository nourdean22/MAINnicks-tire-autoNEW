import { NextResponse } from "next/server";
import { getLatestGovernorDecision } from "@/lib/health-governor/health-governor-guardrails";
import { logger } from "@/lib/logger";
import { apiHandler } from "@/lib/utils/http";

const log = logger.withSurface("api/health/governor/today");

export const GET = apiHandler(async () => {
  try {
    const decision = await getLatestGovernorDecision();
    if (!decision) {
      return NextResponse.json({ error: "No governor data available." }, { status: 404 });
    }
    return NextResponse.json(decision);
  } catch (err) {
    log.error("governor_today_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}, { auth: "owner" });
export const dynamic = "force-dynamic";
