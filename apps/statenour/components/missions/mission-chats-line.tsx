"use client";

/**
 * The chats Nick linked to this mission (W7, map gap 8): newest titles, each opening that conversation.
 * "failed" says so; loading and a mission with no linked chats render nothing.
 */
import Link from "next/link";

import { MISSION_CHATS_PER_MISSION } from "@/lib/missions/mission-chats-limits";

type ChatLink = { id: string; title: string; updatedAt: string | Date };

export type MissionChatsRead =
  | { chats: ChatLink[]; truncated: boolean }
  | "loading"
  | "failed"
  /** The mission was past the one read's id limit: never read, so never "no chats". */
  | "unread";

/** One card's read from the board's single query: past the id limit is "unread", a failed query is "failed". */
export function missionChatsReadFor(
  id: string,
  readIds: readonly string[],
  // The query's data as it arrives on the wire (dates are strings).
  q: { data?: { byMission: Record<string, ChatLink[]>; truncated: boolean }; isError: boolean },
): MissionChatsRead {
  if (!readIds.includes(id)) return "unread";
  if (!q.data) return q.isError ? "failed" : "loading";
  const chats = q.data.byMission[id] ?? [];
  return { chats, truncated: q.data.truncated && chats.length < MISSION_CHATS_PER_MISSION };
}

export function MissionChatsLine({ read }: { read: MissionChatsRead | undefined }) {
  if (read === "failed") {
    return (
      <p role="status" className="px-3 py-1 text-[12px] text-amber-300 sm:px-4">
        Linked chats couldn&apos;t load
      </p>
    );
  }
  if (read === "unread") {
    return <p className="px-3 py-1 text-[12px] text-fg-tertiary sm:px-4">Linked chats not read for this mission</p>;
  }
  if (!read || read === "loading") return null;
  if (read.chats.length === 0) {
    return read.truncated ? <p className="px-3 py-1 text-[12px] text-fg-tertiary sm:px-4">Older linked chats not read</p> : null;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1 px-3 text-[12px] text-fg-tertiary sm:px-4">
      <span>Chats</span>
      {read.chats.map((c) => (
        <Link
          key={c.id}
          href={`/chat?cid=${encodeURIComponent(c.id)}`}
          className="inline-flex min-h-11 max-w-[14rem] items-center px-1 text-fg-secondary underline-offset-2 hover:underline"
          title={c.title}
        >
          <span className="truncate">{c.title}</span>
        </Link>
      ))}
      {read.truncated && <span>· older chats not shown</span>}
    </p>
  );
}
