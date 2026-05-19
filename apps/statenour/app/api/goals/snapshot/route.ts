/**
 * GET /api/goals/snapshot · Phase A.1 (2026-05-17) · Phase OO (2026-05-19 AM)
 *
 * Owner-only · returns the composite payload for /goals page:
 *   · ladder (LifeGoal grouped by horizon)
 *   · missions (active · sorted by priority+ROI)
 *   · axes (latest MasteryScore per domain + 7d delta)
 *   · pruneCandidates count
 *
 * Phase OO · heavy lifting still in `lib/services/goals-snapshot.ts` ·
 * BOTH this REST endpoint AND the new `trpc.operator.goalsSnapshot`
 * query call the same `buildGoalsSnapshot` function · drift between
 * the two consumers structurally impossible. Stays mounted for
 * back-compat with any non-tRPC consumer.
 *
 * Single round-trip · no AI calls · no bridge hits · ~200-400ms typical.
 *
 * See: lib/services/goals-snapshot.ts · ADR-0010
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { buildGoalsSnapshot } from "@/lib/services/goals-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const snapshot = await buildGoalsSnapshot();
    return NextResponse.json(snapshot, {
      headers: {
        // Cache-control on the client side · 30s freshness is plenty
        // for a goals page (numbers don't move every second).
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json(
      {
        error: "goals_snapshot_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
