import { requireSession } from "@/lib/auth-guard";
import { deleteConversation } from "@/lib/services/chat-conversation";
// hooks-lib REST→tRPC slice (2026-05-22) · the conversation read +
// title-rename services · also called by the new `chat.conversation` +
// `chat.renameConversation` tRPC procedures · drift impossible.
import {
  readConversation,
  renameConversation,
  ConversationNotFoundError,
} from "@/lib/services/chat-conversation-read";

export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // v10.0.183 · CRITICAL · pre-fix this GET was unauthenticated. Any
  // unauth request that guessed or enumerated a conversation cuid
  // got the full message history (including private brain context,
  // attachments, tool calls). PATCH and DELETE were guarded but GET
  // wasn't — three-line audit miss.
  await requireSession(req);
  const { id } = await params;

  // hooks-lib REST→tRPC slice (2026-05-22) · the single-conversation
  // read (full message history hydration) moved to the shared
  // `chat-conversation-read.readConversation` so this legacy REST
  // consumer AND the new `chat.conversation` tRPC procedure can't
  // drift. `useConversations` now reads tRPC; this stays mounted.
  try {
    const conversation = await readConversation({ id });
    return Response.json({ conversation });
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession(req);
  const { id } = await params;
  const body = await req.json().catch((): Record<string, unknown> => ({}));
  if (typeof body.title !== "string") {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }
  // hooks-lib REST→tRPC slice (2026-05-22) · the title-rename moved to
  // the shared `chat-conversation-read.renameConversation` so this
  // legacy REST consumer AND the new `chat.renameConversation` tRPC
  // procedure can't drift.
  try {
    const conversation = await renameConversation({ id, title: body.title });
    return Response.json({ conversation });
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession(req);
  const { id } = await params;

  // Phase B.5 · idempotent hard-delete lives in the shared
  // `deleteConversation` service · `trpc.chat.deleteConversation`
  // calls the same function · drift impossible.
  return Response.json(await deleteConversation({ id }));
}
