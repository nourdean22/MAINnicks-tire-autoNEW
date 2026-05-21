import { NextResponse } from "next/server";
import { ingestJournal } from "@/lib/brain/journal-ingest";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { sanitizeError } from "@/lib/utils/sanitize-error";

/**
 * POST /api/journal/capture
 *
 * Raw-text capture endpoint used by the global FloatingCapture
 * modal (Cmd+Shift+J on any page). Runs the full journal-ingest
 * pipeline, returns the structured result so the UI can show the
 * extracted summary + task count immediately.
 *
 * Body shape: { text: string }
 *
 * v10.0.529.21 · D-1 fix · added checkAiRateLimit (10/min/IP) ·
 * each capture fires a full AI aiChat call + pgvector embedding
 * write + multiple Prisma writes inside ingestJournal. Rapid
 * double-submit (laggy connection, Telegram webhook replay)
 * previously fanned out duplicate AI calls and created duplicate
 * BrainDump rows with identical rawThoughts. Same pattern as
 * /api/ultron/reflect which already had the cap.
 */
export async function POST(req: Request) {
  try {
    await requireSession(req);

    // v10.0.529.21 · rate-limit gate · the audit's D-1 item.
    const limit = checkAiRateLimit(req);
    if (limit) return limit;

    // Defensive parse · matches sibling journal routes
    // (threads/suggestions). Malformed JSON or a non-string `text`
    // resolves to "" → the min-length guard returns a clean 400
    // instead of a TypeError-driven 500.
    const body = (await req.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text || text.length < 3) {
      return NextResponse.json(
        { error: "text required (min 3 chars)" },
        { status: 400 }
      );
    }
    const result = await ingestJournal(text, "manual");
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // v10.0.529.21 · sanitize the error before returning · pre-fix
    // `String(err)` leaked raw Prisma/Neon strings to the client.
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 }
    );
  }
}
