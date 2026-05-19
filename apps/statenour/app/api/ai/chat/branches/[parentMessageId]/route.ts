/**
 * GET /api/ai/chat/branches/[parentMessageId]
 *
 * Returns all assistant siblings (regenerations) under a single user
 * message · ordered oldest-first · powers the per-message
 * "alt 2 of 3" cycle UI.
 *
 * Phase DD (2026-05-18 PM) · heavy lifting moved to
 * `lib/services/chat-branches.ts` so both this REST endpoint AND
 * the `trpc.chat.branches` procedure call the same `readChatBranches()`
 * function · drift between the two consumers is structurally
 * impossible. Stays mounted for back-compat with any non-tRPC consumer.
 *
 * Auth: session (the messages are private to the operator's brain).
 *
 * Edge cases:
 *   · parentMessageId not found → empty siblings array, count: 0
 *     (not 404 — caller might race the regen write)
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { readChatBranches } from "@/lib/services/chat-branches";

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
    return NextResponse.json(
      { error: "parentMessageId required" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await readChatBranches({ parentMessageId }));
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
