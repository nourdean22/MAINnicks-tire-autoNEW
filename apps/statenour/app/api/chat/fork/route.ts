/**
 * POST /api/chat/fork
 *
 * Branching conversations (#4). Creates a new chatConversation that
 * inherits all messages from an existing conversation UP TO a given
 * messageId. Lets Nour explore an alternate path from any point in
 * the chat without losing the original thread.
 *
 * Body: { sourceConversationId: string, upToMessageId: string, titleSuffix?: string }
 * Returns: { forkId, title, messageCount }
 *
 * misc-pages slice (2026-05-22 · legacy-modernizer REST→tRPC) · the
 * fork logic moved to the shared `lib/services/chat-fork` module the
 * `chat.fork` tRPC mutation also calls · drift structurally
 * impossible. The route stays mounted as the rollback path.
 */

import { recordError } from "@/lib/errors/record-error";
import { requireSession } from "@/lib/auth-guard";
import {
  forkConversation,
  ForkSourceNotFoundError,
  ForkInvalidPivotError,
} from "@/lib/services/chat-fork";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json()) as {
      sourceConversationId: string;
      upToMessageId: string;
      titleSuffix?: string;
    };

    if (!body.sourceConversationId || !body.upToMessageId) {
      return Response.json(
        { error: "sourceConversationId and upToMessageId required" },
        { status: 400 },
      );
    }

    const result = await forkConversation({
      sourceConversationId: body.sourceConversationId,
      upToMessageId: body.upToMessageId,
      titleSuffix: body.titleSuffix,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof ForkSourceNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ForkInvalidPivotError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    recordError("api:unknown", err, { route: "chat/fork" });
    return Response.json(
      { error: err instanceof Error ? err.message : "fork failed" },
      { status: 500 },
    );
  }
}
