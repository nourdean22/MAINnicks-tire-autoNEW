/**
 * POST /api/chat/resolve-mention
 *
 * Backend for the async mention expansion path (#7 Mentions 2.0).
 * The chat input hook calls this just before send() when the message
 * contains @yesterday / @week / @cold, and swaps each token with the
 * returned value before the message ships to the AI.
 *
 * hooks-lib REST→tRPC slice (2026-05-22) · the token-resolution logic
 * (@yesterday / @week / @cold) moved verbatim to
 * `lib/services/resolve-mention.resolveMention` so the legacy REST
 * consumer AND the new `chat.resolveMention` tRPC procedure can't
 * drift. `useMentionSuggestions` now reads tRPC; this route stays
 * mounted as the coexistence / rollback path.
 *
 * Body: { key: "yesterday" | "week" | "cold", surroundingText?: string }
 * Returns: { value: string }
 */

import { recordError } from "@/lib/errors/record-error";
import { requireSession } from "@/lib/auth-guard";
import { resolveMention } from "@/lib/services/resolve-mention";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json()) as {
      key: string;
      surroundingText?: string;
    };
    return Response.json(
      await resolveMention({
        key: body.key,
        surroundingText: body.surroundingText,
      }),
    );
  } catch (err) {
    recordError("api:unknown", err, { route: "chat/resolve-mention" });
    return Response.json({ value: "[mention resolution failed]" }, { status: 500 });
  }
}
