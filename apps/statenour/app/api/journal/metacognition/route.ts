import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { getLatestLearningJournalEntry } from "@/lib/brain/learning-journal";
import { sanitizeError } from "@/lib/utils/sanitize-error";

/**
 * GET /api/journal/metacognition
 *
 * Returns the most-recent learning-journal entry — Nick's nightly
 * self-assessment of his own brain. Powers the small metacognition
 * card at the top of /journal.
 *
 * Phase TT (2026-05-19 AM) · also exposed as `trpc.journal.metacognition`.
 * Both call the same `getLatestLearningJournalEntry()` helper · drift
 * impossible.
 */
export async function GET(req: Request) {
  await requireSession(req);
  try {
    const entry = await getLatestLearningJournalEntry();
    return NextResponse.json({ data: entry });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
