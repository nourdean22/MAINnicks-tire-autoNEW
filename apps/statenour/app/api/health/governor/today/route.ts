import { NextRequest, NextResponse } from "next/server";
import { getLatestGovernorDecision } from "@/lib/health-governor/health-governor-guardrails";

export async function GET(req: NextRequest) {
  try {
    const decision = await getLatestGovernorDecision();
    if (!decision) {
      return NextResponse.json({ error: "No governor data available." }, { status: 404 });
    }
    return NextResponse.json(decision);
  } catch (err) {
    console.error("Failed to fetch today's governor state:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
export const dynamic = "force-dynamic";
