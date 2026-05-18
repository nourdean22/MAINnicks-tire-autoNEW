/**
 * GET /api/operator/pulse · Phase E (2026-05-18 PM)
 *
 * Owner-only · returns the OperatorPulse payload for the requested
 * surface. Query param: `?surface=tasks|goals|scoreboard|home`.
 *
 * Single round-trip · no AI calls · reuses the goals + scoreboard
 * snapshots already in production · ~300-500ms typical.
 *
 * Caching: 30s private. Pulse moves with the operator's actions (task
 * complete, goal update) but doesn't need second-by-second freshness ·
 * 30s strikes the right balance between freshness and avoiding query
 * thrash when the four surfaces all mount the same component.
 *
 * See: lib/services/operator-pulse.ts · ADR-0016 (pending).
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import {
  buildOperatorPulse,
  type PulseSurface,
} from "@/lib/services/operator-pulse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const VALID_SURFACES = new Set<PulseSurface>([
  "tasks",
  "goals",
  "scoreboard",
  "home",
]);

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("surface") ?? "home").toLowerCase();
    const surface = VALID_SURFACES.has(raw as PulseSurface)
      ? (raw as PulseSurface)
      : ("home" as PulseSurface);
    const snapshot = await buildOperatorPulse(surface);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: "operator_pulse_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
