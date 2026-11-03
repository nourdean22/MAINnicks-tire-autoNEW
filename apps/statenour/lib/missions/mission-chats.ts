/**
 * The chats linked to each mission on /missions (job 2026-11-02-nour-os-interconnect W7, map gap 8).
 *
 * `chat_conversations.mission_id` is written by the conversation-mission-link cron (config/crons.ts) and had no
 * reader. One query for the whole board; archived chats are left out. A failed read throws, so the page's query
 * reports isError and the card says "couldn't load" instead of "no chats".
 */
import { prisma } from "@/lib/prisma";

/** CONTROLS RULE: titles shown per mission, and the one read's row cap, named once. */
export const MISSION_CHATS_PER_MISSION = 3;
export const MISSION_CHATS_READ_CAP = 300;
/** Missions per read (the procedure's input cap); a mission past it shows "not read". */
export const MISSION_CHATS_IDS_MAX = 100;

export interface MissionChat {
  id: string;
  title: string;
  updatedAt: Date;
}

export interface MissionChatsResult {
  byMission: Record<string, MissionChat[]>;
  /** The read filled MISSION_CHATS_READ_CAP: a mission showing fewer than its cap may have older chats unread. */
  truncated: boolean;
}

export async function missionChats(missionIds: string[]): Promise<MissionChatsResult> {
  const ids = [...new Set(missionIds)];
  if (ids.length === 0) return { byMission: {}, truncated: false };
  // shortcut: one newest-first read capped at MISSION_CHATS_READ_CAP rows; `truncated` says when it filled, so a
  // mission past the cap reads "not read", not "no chats". Move to a per-mission window query if that starts showing.
  const rows = await prisma.chatConversation.findMany({
    where: { missionId: { in: ids }, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: MISSION_CHATS_READ_CAP,
    select: { id: true, missionId: true, title: true, updatedAt: true },
  });
  const out: Record<string, MissionChat[]> = {};
  for (const r of rows) {
    if (!r.missionId) continue;
    const list = (out[r.missionId] ??= []);
    if (list.length < MISSION_CHATS_PER_MISSION) {
      list.push({ id: r.id, title: r.title?.trim() || "Untitled chat", updatedAt: r.updatedAt });
    }
  }
  return { byMission: out, truncated: rows.length >= MISSION_CHATS_READ_CAP };
}
