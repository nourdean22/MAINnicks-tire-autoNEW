/**
 * GET /api/system/tools/stats — tool registry + family rollup.
 *
 * Joins the static TOOL_FAMILIES metadata with live tool availability
 * from nourTools + BrainMemory-backed per-tool telemetry.
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · the assembly logic moved to the shared
 * `lib/services/system-pages-b.buildToolStats` service · this route AND
 * the new `trpc.system.toolStats` procedure call the same function ·
 * drift impossible. The route stays mounted as the rollback path.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { buildToolStats } from "@/lib/services/system-pages-b";

export async function GET(req: Request) {
  await requireSession(req);
  try {
    const data = await buildToolStats();
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
