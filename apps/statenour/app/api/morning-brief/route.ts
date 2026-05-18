/**
 * /api/morning-brief · 2026-05-18 PM follow-up
 *
 * Owner-only · returns today's morning brief metadata + text so the
 * /voice page can preview what the audio will say before the operator
 * taps play.
 *
 * Pre-existing routes:
 *   · /api/morning-brief/today.mp3 · the rendered Cartesia audio
 *
 * This route adds the TEXT side so the page can show:
 *   · whether today's brief exists (operator might visit before 10am UTC)
 *   · when it was composed
 *   · the first sentence as a preview (so operator knows what they're
 *     about to hear)
 *
 * Reads BrainMemory(morning_brief, today-date) directly · same row the
 * Inngest composer writes at 10:00 UTC + the audio endpoint reads.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 5;

const log = rootLogger.withSurface("api/morning-brief");

/**
 * Strip simple HTML tags so the preview reads as plain prose.
 * The brief composer uses <b>, <i> for slice separators. We strip
 * them for the preview · the full text retains the HTML for clients
 * that want to render it.
 */
function stripHtmlForPreview(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ") // strip tags
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });

    const row = await prisma.brainMemory.findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.MORNING_BRIEF, key: today } },
      select: { content: true, updatedAt: true, metadata: true },
    });

    if (!row || !row.content) {
      return NextResponse.json({
        ready: false,
        date: today,
        composedAt: null,
        text: null,
        preview: null,
      });
    }

    // Preview · first ~140 chars of the stripped text, rounded to a
    // sentence boundary so it reads naturally.
    const stripped = stripHtmlForPreview(row.content);
    let preview = stripped.slice(0, 200);
    const lastPeriod = preview.lastIndexOf(".");
    if (lastPeriod > 60) {
      preview = preview.slice(0, lastPeriod + 1);
    }

    return NextResponse.json({
      ready: true,
      date: today,
      composedAt: row.updatedAt.toISOString(),
      text: row.content,
      preview,
    });
  } catch (err) {
    log.error("brief_fetch_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
