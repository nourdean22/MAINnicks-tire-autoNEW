/**
 * POST /api/outcomes/rate — record a verdict on one intelligence_outcomes row.
 *
 * WHY THIS EXISTS. `recordShown` had 24 callers and `recordOutcome` had two,
 * both inside discoveries.ts, so every proactive_push and daily_brief row was
 * STRUCTURALLY UNLABELABLE — nothing anywhere could express a verdict on them.
 * #2424 fixed the proactive_push half with Telegram callback buttons. It did
 * not fix the daily brief, because the brief's primary surface is WEB PUSH,
 * which had no affordance at all: ~90 rows, zero labels.
 *
 * ★ An outcome ledger with a writer and no rater measures delivery, not
 *   usefulness. The fix is an affordance, not a reminder.
 *
 * The caller is public/sw.js's `notificationclick` handler, which posts here
 * when the operator taps a rating action on the notification itself. Same-origin
 * from the service worker, so the session cookie rides along.
 */
import { requireSession } from "@/lib/auth-guard";
import { recordOutcome } from "@/lib/services/outcome-ledger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await requireSession(req);

  let body: { id?: unknown; useful?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  if (typeof body.useful !== "boolean") {
    // Deliberately strict: a missing verdict must not default to "useful" and
    // manufacture a label the operator never gave. An unlabelled row is honest;
    // a wrong label poisons every rate computed from this table.
    return NextResponse.json({ ok: false, error: "useful must be boolean" }, { status: 400 });
  }

  // recordOutcome only updates rows with `outcomeAt: null`, so a second tap on
  // the same notification returns false rather than overwriting the first
  // verdict. Report that distinctly instead of as a failure.
  const recorded = await recordOutcome({ id, useful: body.useful });
  return NextResponse.json({ ok: true, recorded, alreadyRated: !recorded });
}
