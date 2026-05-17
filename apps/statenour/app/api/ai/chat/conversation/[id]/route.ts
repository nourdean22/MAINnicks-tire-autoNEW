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
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";

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

  const data: Record<string, unknown> = {};
  if (typeof body.archived === "boolean") data.archivedAt = body.archived ? new Date() : null;
  if (typeof body.starred === "boolean")  data.starredAt  = body.starred  ? new Date() : null;
  if (typeof body.muted === "boolean")    data.mutedAt    = body.muted    ? new Date() : null;
  if (typeof body.title === "string") {
    const t = body.title.trim().slice(0, 200);
    if (t) data.title = t;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.chatConversation.update({
      where: { id },
      data: data as Parameters<typeof prisma.chatConversation.update>[0]["data"],
      select: {
        id: true,
        title: true,
        archivedAt: true,
        starredAt: true,
        mutedAt: true,
        lastActiveAt: true,
        messageCount: true,
      },
    });
    return NextResponse.json({ ok: true, conversation: updated });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update failed" },
      { status: 500 },
    );
  }
}
