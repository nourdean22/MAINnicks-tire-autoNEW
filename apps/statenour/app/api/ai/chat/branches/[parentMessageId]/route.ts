/**
 * GET /api/ai/chat/branches/[parentMessageId]
 *
 * v7.6 · C8 · Apr 29 · ChatMessage Batch A — branching API.
 *
 * Returns all assistant siblings (regenerations) under a single user
 * message, ordered oldest-first. Powers the per-message
 * "alt 2 of 3" cycle UI.
 *
 * Response shape:
 *   {
 *     parentMessageId: string,
 *     siblings: Array<{
 *       id, content, parts, model, provider, createdAt, feedbackScore,
 *       latencyMs, costCents, streamingState
 *     }>,
 *     count: number
 *   }
 *
 * Auth: session (the messages are private to Nour's brain).
 *
 * Edge cases:
 *   · parentMessageId not found → empty siblings array, count: 0
 *     (not 404 — caller might race the regen write)
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ parentMessageId: string }> },
) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { parentMessageId } = await params;
  if (!parentMessageId || typeof parentMessageId !== "string") {
    return NextResponse.json({ error: "parentMessageId required" }, { status: 400 });
  }

  try {
    const siblings = await prisma.chatMessage.findMany({
      where: {
        parentMessageId,
        role: "assistant",
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        content: true,
        parts: true,
        model: true,
        provider: true,
        latencyMs: true,
        firstTokenLatencyMs: true,
        costCents: true,
        promptTokens: true,
        completionTokens: true,
        streamingState: true,
        feedbackScore: true,
        attachmentsHash: true,
        editedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      parentMessageId,
      count: siblings.length,
      siblings,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "branches fetch failed",
        parentMessageId,
        count: 0,
        siblings: [],
      },
      { status: 500 },
    );
  }
}
