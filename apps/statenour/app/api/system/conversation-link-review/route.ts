/**
 * Conversation→mission link review · v10.0.191
 *
 * v10.0.189 shipped the linker; v10.0.190 tuned thresholds. The
 * linker queues conversations with cosine 0.45–0.55 against their
 * top mission as BrainMemory rows (category="conversation_mission_
 * link_review"). Until this endpoint, those candidates were
 * INVISIBLE — operator had no way to approve/reject them.
 *
 * GET   list pending reviews (sorted by similarity, highest first)
 * POST  decide one: { conversationId, missionId, decision }
 *         "approve" → write ChatConversation.mission_id + delete row
 *         "reject"  → delete row (mission stays unlinked)
 *         "snooze"  → keep row but bump lastSeen so it falls below
 *                     other candidates (deferred review)
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { ServiceError } from "@/lib/utils/service-error";

const CATEGORY = "conversation_mission_link_review";

const DecideSchema = z.object({
  conversationId: z.string().min(1),
  missionId: z.string().min(1),
  decision: z.enum(["approve", "reject", "snooze"]),
});

export const GET = apiHandler(async () => {
  const rows = await prisma.brainMemory.findMany({
    where: { category: CATEGORY, deletedAt: null },
    orderBy: { confidence: "desc" },
  });

  const candidates = rows.map((r) => {
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
}, { auth: "owner" });

export const POST = apiHandler(async (req) => {
  const body = await req.json();
  const parsed = DecideSchema.safeParse(body);
  if (!parsed.success) {
    throw new ServiceError(`bad request: ${parsed.error.message}`, 400);
  }
  const { conversationId, missionId, decision } = parsed.data;
  const key = `${conversationId}:${missionId}`;

  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: CATEGORY, key } },
  });
  if (!existing) {
    throw new ServiceError("review row not found", 404);
  }

  if (decision === "approve") {
    // v10.0.191 · single transaction so we never end up with the
    // mission link without removing the review row, or vice versa.
    // Soft-delete the review row instead of hard-delete so we keep
    // an audit trail of accepted links.
    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE chat_conversations
        SET mission_id = ${missionId}, updated_at = NOW()
        WHERE id = ${conversationId}
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
    return { ok: true, decision, conversationId, missionId };
  }

  if (decision === "reject") {
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
    return { ok: true, decision, conversationId, missionId };
  }

  // snooze — bump lastSeen so it sinks to the bottom of the list
  // for the next review pass. The cron will refresh it if the
  // similarity is still in range.
  await prisma.brainMemory.update({
    where: { category_key: { category: CATEGORY, key } },
    data: { lastSeen: new Date() },
  });
  return { ok: true, decision, conversationId, missionId };
}, { auth: "owner" });
