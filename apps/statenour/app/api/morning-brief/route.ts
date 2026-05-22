/**
 * /api/morning-brief · 2026-05-18 PM follow-up ·
 * slimmed straggler-pages REST→tRPC slice (2026-05-22).
 *
 * Owner-only · returns today's morning brief metadata + text so the
 * /voice page can preview what the audio will say before the operator
 * taps play.
 *
 * Pre-existing routes:
 *   · /api/morning-brief/today.mp3 · the rendered Cartesia audio
 *
 * The BrainMemory read moved to lib/services/morning-brief-read.ts so
 * this route and the new `operator.morningBrief` tRPC procedure call
 * ONE function · drift impossible. This route is the thin REST shell
 * that stays mounted.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { readMorningBrief } from "@/lib/services/morning-brief-read";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 5;

const log = rootLogger.withSurface("api/morning-brief");

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const payload = await readMorningBrief();
    return NextResponse.json(payload);
  } catch (err) {
    log.error("brief_fetch_failed", { error: sanitizeError(err) });
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}
