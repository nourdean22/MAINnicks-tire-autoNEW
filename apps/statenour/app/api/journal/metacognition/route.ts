import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { getLatestLearningJournalEntry } from "@/lib/brain/learning-journal";
import { sanitizeError } from "@/lib/utils/sanitize-error";

/**
 * GET /api/journal/metacognition
 *
 * Returns the most-recent learning-journal entry — Nick's nightly
 * self-assessment of his own brain. Powers the small metacognition
 * card at the top of /journal so the operator can see learningRate
 * + trend + calibrationScore + weakSpots without re-running the
 * 16-query Promise.all that the cron does.
 *
 * Response shape: `{ data: JournalEntry | null }`. Null when no
 * cron run has landed yet, or the legacy rows have no structured
 * metadata. The page renders nothing in that case.
 *
 * v10.0.529.24 · /journal audit deferred item · the latent
 * operator-leverage gap (cron computes metacognition but nothing
 * surfaces it on the page) closed.
 */
export async function GET(req: Request) {
  await requireSession(req);

  try {
    const entry = await getLatestLearningJournalEntry();
    return NextResponse.json({ data: entry });
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 }
    );
  }
}
