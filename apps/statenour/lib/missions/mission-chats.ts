/**
 * The chats linked to each mission on /missions (job 2026-11-02-nour-os-interconnect W7, map gap 8).
 *
 * `chat_conversations.mission_id` is written by the conversation-mission-link cron (config/crons.ts) and had no
 * reader. One query for the whole board; archived chats are left out. A failed read throws, so the page's query
 * reports isError and the card says "couldn't load" instead of "no chats".
 *
 * W8c · the same read counts each mission's open link-review rows (the cron's medium matches, read and decided by
 * lib/services/link-review.ts), so a card can say "2 chats need a yes". Either read failing fails the whole read.
 */
import { prisma } from "@/lib/prisma";

import {
  MISSION_CHATS_PER_MISSION,
  MISSION_CHATS_READ_CAP,
  MISSION_REVIEW_READ_CAP,
  type MissionChat,
  type MissionChatsResult,
} from "@/lib/missions/mission-chats-limits";

export * from "@/lib/missions/mission-chats-limits";

/** The BrainMemory category the linker queues review rows under (lib/services/link-review.ts reads the same). */
const LINK_REVIEW_CATEGORY = "conversation_mission_link_review";

export async function missionChats(missionIds: string[]): Promise<MissionChatsResult> {
  const ids = [...new Set(missionIds)];
  if (ids.length === 0) return { byMission: {}, truncated: false, reviewByMission: {} };
  // shortcut: one newest-first read capped at MISSION_CHATS_READ_CAP rows; `truncated` says when it filled, so a
  // mission past the cap reads "not read", not "no chats". Move to a per-mission window query if that starts showing.
  const [rows, reviews] = await Promise.all([
    prisma.chatConversation.findMany({
      where: { missionId: { in: ids }, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: MISSION_CHATS_READ_CAP,
      select: { id: true, missionId: true, title: true, updatedAt: true },
    }),
    // The mission id lives in the row's metadata (JSON), so the filter by mission happens here, not in SQL.
    prisma.brainMemory.findMany({
      where: { category: LINK_REVIEW_CATEGORY, deletedAt: null },
      take: MISSION_REVIEW_READ_CAP,
      select: { metadata: true },
    }),
  ]);
  const out: Record<string, MissionChat[]> = {};
  for (const r of rows) {
    if (!r.missionId) continue;
    const list = (out[r.missionId] ??= []);
    if (list.length < MISSION_CHATS_PER_MISSION) {
      list.push({ id: r.id, title: r.title?.trim() || "Untitled chat", updatedAt: r.updatedAt });
    }
  }
  const wanted = new Set(ids);
  const open = reviews.flatMap((r) => {
    const m = (r.metadata ?? {}) as { missionId?: unknown; conversationId?: unknown };
    return typeof m.missionId === "string" && wanted.has(m.missionId)
      ? [{ missionId: m.missionId, conversationId: typeof m.conversationId === "string" ? m.conversationId : null }]
      : [];
  });
  // A chat linked since it was queued (by the cron or a review approval) no longer needs a yes.
  const convIds = [...new Set(open.flatMap((r) => (r.conversationId ? [r.conversationId] : [])))];
  const linked =
    convIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await prisma.chatConversation.findMany({
              where: { id: { in: convIds }, missionId: { not: null } },
              select: { id: true },
            })
          ).map((c) => c.id),
        );
  const reviewByMission: Record<string, number> = {};
  for (const r of open) {
    if (r.conversationId && linked.has(r.conversationId)) continue;
    reviewByMission[r.missionId] = (reviewByMission[r.missionId] ?? 0) + 1;
  }
  return { byMission: out, truncated: rows.length >= MISSION_CHATS_READ_CAP, reviewByMission };
}
