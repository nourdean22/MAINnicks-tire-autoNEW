/**
 * lib/services/morning-brief-read.ts · straggler-pages REST→tRPC slice
 * (2026-05-22).
 *
 * Lifted verbatim from app/api/morning-brief/route.ts so the legacy
 * REST endpoint AND the new `operator.morningBrief` tRPC procedure
 * call the same function · drift between consumers structurally
 * impossible.
 *
 * Distinct from lib/services/morning-brief.ts — that module is the
 * brief *composer* (`buildMorningBrief`, run by the 10:00 UTC Inngest
 * job, which WRITES the BrainMemory row). This module is the *reader*:
 * it loads the already-composed row so the /voice page can preview
 * what the audio will say before the operator taps play.
 *
 * NOTE · the rendered audio endpoint (/api/morning-brief/today.mp3)
 * stays REST · it streams a binary mp3 body, which tRPC cannot carry.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface MorningBriefView {
  ready: boolean;
  date: string;
  composedAt: string | null;
  text: string | null;
  preview: string | null;
}

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

/** Today's morning-brief metadata + text + a sentence-bounded preview. */
export async function readMorningBrief(): Promise<MorningBriefView> {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const row = await prisma.brainMemory.findUnique({
    where: {
      category_key: {
        category: BRAIN_CATEGORIES.MORNING_BRIEF,
        key: today,
      },
    },
    select: { content: true, updatedAt: true, metadata: true },
  });

  if (!row || !row.content) {
    return {
      ready: false,
      date: today,
      composedAt: null,
      text: null,
      preview: null,
    };
  }

  // Preview · first ~200 chars of the stripped text, rounded to a
  // sentence boundary so it reads naturally.
  const stripped = stripHtmlForPreview(row.content);
  let preview = stripped.slice(0, 200);
  const lastPeriod = preview.lastIndexOf(".");
  if (lastPeriod > 60) {
    preview = preview.slice(0, lastPeriod + 1);
  }

  return {
    ready: true,
    date: today,
    composedAt: row.updatedAt.toISOString(),
    text: row.content,
    preview,
  };
}
