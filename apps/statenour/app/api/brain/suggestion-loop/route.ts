/**
 * POST /api/brain/suggestion-loop
 *
 * Captures the supervised-signal loop for Nick suggestions:
 *   - action:    operator acted / dismissed / modified / deferred
 *   - outcome:   downstream result (positive / negative / neutral)
 *
 * Body (action variant):
 *   {
 *     "type": "action",
 *     "suggestionId": "broken-promise-abc123",
 *     "suggestionKind": "broken-promise",
 *     "event": "acted",
 *     "delaySeconds": 42,
 *     "notes": "sent the SMS"
 *   }
 *
 * Body (outcome variant):
 *   {
 *     "type": "outcome",
 *     "suggestionId": "broken-promise-abc123",
 *     "suggestionKind": "broken-promise",
 *     "polarity": "positive",
 *     "delaySeconds": 3600,
 *     "notes": "customer replied + booked"
 *   }
 *
 * Auth: same NextAuth session as the rest of /api · the recordings
 * are operator-only data, not multi-tenant.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  trackSuggestionAction,
  recordSuggestionOutcome,
} from "@/lib/brain/suggestion-loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const root = body as Record<string, unknown> | null;
  if (!root || typeof root !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const type = root.type;
  if (type !== "action" && type !== "outcome") {
    return NextResponse.json(
      { error: "type must be 'action' or 'outcome'" },
      { status: 400 },
    );
  }

  try {
    if (type === "action") {
      const { id, key } = await trackSuggestionAction(root);
      return NextResponse.json({ ok: true, id, key });
    }
    const { id, key } = await recordSuggestionOutcome(root);
    return NextResponse.json({ ok: true, id, key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Zod validation failures land here · expose the message so clients
    // can surface "wrong shape" without a generic 500.
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
