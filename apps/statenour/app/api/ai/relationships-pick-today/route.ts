/**
 * /api/ai/relationships-pick-today · Wave AB Phase 1B · 2026-05-28.
 *
 * Returns Nick's top 3 outreach picks for today. Cached daily in
 * BrainMemory(relationships_picks_today). Owner-gated.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { pickRelationshipsForToday } from "@/lib/ai/relationships-pick-today";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/relationships-pick-today");

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await pickRelationshipsForToday();
    return NextResponse.json(result);
  } catch (err) {
    log.error("picks_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { picks: [], generatedAt: new Date().toISOString(), source: "heuristic_fallback" },
      { status: 200 },
    );
  }
}
