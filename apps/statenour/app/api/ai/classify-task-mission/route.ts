/**
 * /api/ai/classify-task-mission · Wave AA Phase 1B · 2026-05-28.
 *
 * Body shape: { taskTitle: string, missions: [{id,title,domain?}] }
 * Returns: { missionId: string|null, confidence: 0-1, rationale: string }
 *
 * Called by the /missions page quick-add path. The caller decides:
 *   confidence ≥ 0.6  → silent attach
 *   confidence <  0.6 → surface "📍 attach?" chip above the new row
 *
 * Owner-only · auth gated. Errors return 200 with a fallback shape so
 * the caller can always fall through to creating an unattached task.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { logger as rootLogger } from "@/lib/logger";
import { classifyTaskToMission } from "@/lib/ai/classify-task-mission";

const log = rootLogger.withSurface("api/ai/classify-task-mission");

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      taskTitle?: string;
      missions?: Array<{ id: string; title: string; domain?: string | null }>;
    };

    if (
      !body ||
      typeof body.taskTitle !== "string" ||
      !Array.isArray(body.missions)
    ) {
      return NextResponse.json(
        { missionId: null, confidence: 0, rationale: "" },
        { status: 200 },
      );
    }

    const result = await classifyTaskToMission({
      taskTitle: body.taskTitle,
      missions: body.missions
        .filter(
          (m): m is { id: string; title: string; domain?: string | null } =>
            !!m && typeof m.id === "string" && typeof m.title === "string",
        )
        .slice(0, 50),
    });

    return NextResponse.json(result);
  } catch (err) {
    log.warn("classify_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    // Fallback shape so the caller falls through to unattached.
    return NextResponse.json({
      missionId: null,
      confidence: 0,
      rationale: "",
    });
  }
}
