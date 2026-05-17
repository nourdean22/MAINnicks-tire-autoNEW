import { prisma } from "@/lib/prisma";

import { requireSession } from "@/lib/auth-guard";
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

  const conversation = await prisma.chatConversation.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      // v7.6 · Apr 29 · ChatMessage Batch A · C3 — conversation enrichment fields
      pinnedSummary: true,
      topicTags: true,
      archivedAt: true,
      starredAt: true,
      mutedAt: true,
      lastActiveAt: true,
      messageCount: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          model: true,
          // v7.3 · Apr 29 · Image / file attachments back-compat column.
          attachments: true,
          // v7.6 · Apr 29 · ChatMessage Batch A · full read.
          // Hydrate the rich parts tree so file / reasoning / tool-call /
          // tool-result / source render on reload — not just text.
          parts: true,
          // Idempotency / branching / edit metadata
          clientMessageId: true,
          parentMessageId: true,
          branchId: true,
          editedAt: true,
          editHistory: true,
          // Streaming state (drives the partial / errored / aborted UI)
          streamingState: true,
          errorDetails: true,
          // Observability — surfaced in the per-message info dropdown
          provider: true,
          routerReason: true,
          latencyMs: true,
          firstTokenLatencyMs: true,
          costCents: true,
          promptTokens: true,
          completionTokens: true,
          // Feedback (thumbs up/down learning loop)
          feedbackScore: true,
          // tokenUsage retained for the legacy critic/gate/factCheck/turnSignal
          // payload that the chat UI already reads.
          tokenUsage: true,
          createdAt: true,
        },
      },
    },
  });

  if (!conversation) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ conversation });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession(req);
  const { id } = await params;
  const body = await req.json().catch((): Record<string, unknown> => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.title === "string") data.title = body.title.slice(0, 200);
  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }
  const updated = await prisma.chatConversation.update({
    where: { id },
    data,
    select: { id: true, title: true },
  });
  return Response.json({ conversation: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession(req);
  const { id } = await params;

  await prisma.chatConversation.delete({ where: { id } }).catch((): null => null);

  return Response.json({ ok: true });
}
