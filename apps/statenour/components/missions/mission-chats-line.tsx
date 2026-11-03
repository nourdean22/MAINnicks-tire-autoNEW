"use client";

/**
 * The chats Nick linked to this mission (W7, map gap 8): newest titles, each opening that conversation.
 * "failed" says so; loading and a mission with no linked chats render nothing.
 *
 * W8c · a mission with queued link-review rows says how many chats need a yes (the review inbox lives on
 * /brain?tab=memory, RecallInboxPanel). A board where no mission has a linked chat shows ONE line above the cards
 * (MissionChatsEmptyLine), measured empty only: never while loading, failed or truncated.
 */
import Link from "next/link";

import { LINKER_EMBED_PER_RUN, MISSION_CHATS_PER_MISSION } from "@/lib/missions/mission-chats-limits";

type ChatLink = { id: string; title: string; updatedAt: string | Date };
type ChatsData = { byMission: Record<string, ChatLink[]>; truncated: boolean; reviewByMission?: Record<string, number> };

export type MissionChatsRead =
  | { chats: ChatLink[]; truncated: boolean; reviews: number }
  | "loading"
  | "failed"
  /** The mission was past the one read's id limit: never read, so never "no chats". */
  | "unread";

/** Where the link-review rows are decided (components/brain/memory-tab.tsx mounts RecallInboxPanel). */
export const LINK_REVIEW_HREF = "/brain?tab=memory";

/** One card's read from the board's single query: past the id limit is "unread", a failed query is "failed". */
export function missionChatsReadFor(
  id: string,
  readIds: readonly string[],
  // The query's data as it arrives on the wire (dates are strings).
  q: { data?: ChatsData; isError: boolean },
): MissionChatsRead {
  if (!readIds.includes(id)) return "unread";
  if (!q.data) return q.isError ? "failed" : "loading";
  const chats = q.data.byMission[id] ?? [];
  return { chats, truncated: q.data.truncated && chats.length < MISSION_CHATS_PER_MISSION, reviews: q.data.reviewByMission?.[id] ?? 0 };
}

/** True only for a measured read where no mission on the board has a linked chat. */
export function boardChatsEmpty(q: { data?: ChatsData; isError: boolean }): boolean {
  if (!q.data || q.isError || q.data.truncated) return false;
  return Object.values(q.data.byMission).every((list) => list.length === 0);
}

export function MissionChatsEmptyLine() {
  return (
    <p className="font-mono text-[11px] text-fg-tertiary">
      No chats linked yet · the nightly linker embeds up to {LINKER_EMBED_PER_RUN} chats a night
    </p>
  );
}

function ReviewLink({ count }: { count: number }) {
  return (
    <Link href={LINK_REVIEW_HREF} className="inline-flex min-h-11 items-center px-1 text-amber-300 underline-offset-2 hover:underline">
      {count === 1 ? "1 chat needs a yes" : `${count} chats need a yes`}
    </Link>
  );
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
    if (read.reviews > 0) {
      return (
        <p className="flex flex-wrap items-center gap-x-1 px-3 text-[12px] text-fg-tertiary sm:px-4">
          <ReviewLink count={read.reviews} />
        </p>
      );
    }
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
      {read.reviews > 0 && (
        <>
          <span>·</span>
          <ReviewLink count={read.reviews} />
        </>
      )}
    </p>
  );
}
