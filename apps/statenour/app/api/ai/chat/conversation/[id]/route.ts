/**
 * PATCH /api/ai/chat/conversation/[id]
 *
 * v7.6 · C12 · Apr 29 · ChatMessage Batch A.
 *
 * Toggle conversation flags: archive, star, mute. Update title.
 * One endpoint for all conversation-level mutations so the sidebar
 * UI doesn't need three different routes.
 *
 * Body: any subset of:
 *   { archived: boolean, starred: boolean, muted: boolean, title: string }
 *
 * Effect: writes archivedAt / starredAt / mutedAt as Date|null based
 * on boolean. Title is plain string update.
 *
 * Auth: session.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import {
  updateConversation,
  ConversationNotFoundError,
} from "@/lib/services/chat-conversation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

interface PatchBody {
  archived?: boolean;
  starred?: boolean;
  muted?: boolean;
  title?: string;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Phase B.5 · the flag-toggle + title logic lives in the shared
  // `updateConversation` service · `trpc.chat.updateConversation`
  // calls the same function · drift impossible.
  try {
    const result = await updateConversation({
      id,
      archived: body.archived,
      starred: body.starred,
      muted: body.muted,
      title: body.title,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const msg = err instanceof Error ? err.message : "update failed";
    // "no fields to update" is a client error · everything else 500s.
    if (msg === "no fields to update") {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
