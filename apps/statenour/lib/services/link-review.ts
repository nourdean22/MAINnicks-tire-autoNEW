/**
 * Conversation→mission link review service · Phase VV (2026-05-19 AM).
 *
 * The v10.0.189 linker queues conversations with cosine 0.45–0.55
 * against their top mission as BrainMemory rows
 * (category="conversation_mission_link_review"). This service is the
 * read + decide surface so the operator can approve/reject/snooze.
 *
 * Called by BOTH the legacy `/api/system/conversation-link-review`
 * endpoint AND the new `trpc.brain.linkReview*` procedures · drift
 * between consumers structurally impossible.
 */

import { prisma } from "@/lib/prisma";

const CATEGORY = "conversation_mission_link_review";

export interface LinkCandidate {
  id: string;
  conversationId: string | null;
  missionId: string | null;
  similarity: number;
  conversationTitle: string | null;
  missionTitle: string | null;
  pinnedSummary: string | null;
  topicTags: string | null;
  seenCount: number;
  createdAt: Date;
  lastSeen: Date;
}

export class ReviewRowNotFoundError extends Error {
  constructor(public readonly key: string) {
    super("review row not found");
    this.name = "ReviewRowNotFoundError";
  }
}

export async function listLinkCandidates(): Promise<{
  candidates: LinkCandidate[];
  count: number;
}> {
  const rows = await prisma.brainMemory.findMany({
    where: { category: CATEGORY, deletedAt: null },
    orderBy: { confidence: "desc" },
  });

  const candidates: LinkCandidate[] = rows.map((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      conversationId: typeof m.conversationId === "string" ? m.conversationId : null,
      missionId: typeof m.missionId === "string" ? m.missionId : null,
      similarity: r.confidence,
      conversationTitle:
        typeof m.conversationTitle === "string" ? m.conversationTitle : null,
      missionTitle: typeof m.missionTitle === "string" ? m.missionTitle : null,
      pinnedSummary:
        typeof m.pinnedSummary === "string" ? m.pinnedSummary : null,
      topicTags: typeof m.topicTags === "string" ? m.topicTags : null,
      seenCount: r.seenCount,
      createdAt: r.createdAt,
      lastSeen: r.lastSeen,
    };
  });

  return { candidates, count: candidates.length };
}

export type LinkDecision = "approve" | "reject" | "snooze";

export async function decideLinkCandidate(args: {
  conversationId: string;
  missionId: string;
  decision: LinkDecision;
}): Promise<{
  ok: true;
  decision: LinkDecision;
  conversationId: string;
  missionId: string;
}> {
  const key = `${args.conversationId}:${args.missionId}`;

  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: CATEGORY, key } },
  });
  if (!existing) throw new ReviewRowNotFoundError(key);

  if (args.decision === "approve") {
    // Single transaction so we never end up with the mission link
    // without removing the review row, or vice versa. Soft-delete
    // the review row to keep an audit trail of accepted links.
    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE chat_conversations
        SET mission_id = ${args.missionId}, updated_at = NOW()
        WHERE id = ${args.conversationId}
      `,
      prisma.brainMemory.update({
        where: { category_key: { category: CATEGORY, key } },
        data: {
          deletedAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            ...((existing.metadata as Record<string, unknown>) ?? {}),
            decision: "approved",
            decidedAt: new Date().toISOString(),
          },
        },
      }),
    ]);
    return {
      ok: true,
      decision: args.decision,
      conversationId: args.conversationId,
      missionId: args.missionId,
    };
  }

  if (args.decision === "reject") {
    await prisma.brainMemory.update({
      where: { category_key: { category: CATEGORY, key } },
      data: {
        deletedAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          ...((existing.metadata as Record<string, unknown>) ?? {}),
          decision: "rejected",
          decidedAt: new Date().toISOString(),
        },
      },
    });
    return {
      ok: true,
      decision: args.decision,
      conversationId: args.conversationId,
      missionId: args.missionId,
    };
  }

  // snooze · bump lastSeen so it sinks to the bottom for the next
  // review pass · cron refreshes if similarity stays in range.
  await prisma.brainMemory.update({
    where: { category_key: { category: CATEGORY, key } },
    data: { lastSeen: new Date() },
  });
  return {
    ok: true,
    decision: args.decision,
    conversationId: args.conversationId,
    missionId: args.missionId,
  };
}
