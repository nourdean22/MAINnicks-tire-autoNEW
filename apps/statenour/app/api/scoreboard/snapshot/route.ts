/**
 * GET /api/scoreboard/snapshot · Phase A.2 (2026-05-18)
 *
 * Owner-only · returns the meta-scoreboard payload:
 *   · numbers · 5-10 anchors + anomalies · Nick picks dynamically
 *   · composedAt · ISO timestamp
 *   · lastBriefAt · when the morning brief last fired
 *   · state · "calm" (all anchors) or "alive" (anomalies present)
 *
 * Single round-trip · no AI calls · ~200-400ms typical.
 *
 * See: lib/services/meta-scoreboard.ts · ADR-0011
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { buildMetaScoreboard } from "@/lib/services/meta-scoreboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const snapshot = await buildMetaScoreboard();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      {
        error: "scoreboard_snapshot_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
