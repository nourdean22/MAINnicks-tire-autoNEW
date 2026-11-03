"use client";

/**
 * The chats Nick linked to this mission (W7, map gap 8): newest titles, each opening that conversation.
 * "failed" says so; loading and a mission with no linked chats render nothing.
 */
import Link from "next/link";

export type MissionChatsRead = { id: string; title: string; updatedAt: string | Date }[] | "loading" | "failed";

export function MissionChatsLine({ read }: { read: MissionChatsRead | undefined }) {
  if (read === "failed") {
    return (
      <p role="status" className="px-3 py-1 text-[12px] text-amber-300 sm:px-4">
        Linked chats couldn&apos;t load
      </p>
    );
  }
  if (!read || read === "loading" || read.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1 px-3 text-[12px] text-fg-tertiary sm:px-4">
      <span>Chats</span>
      {read.map((c) => (
        <Link
          key={c.id}
          href={`/chat?cid=${encodeURIComponent(c.id)}`}
          className="inline-flex min-h-11 max-w-[14rem] items-center px-1 text-fg-secondary underline-offset-2 hover:underline"
          title={c.title}
        >
          <span className="truncate">{c.title}</span>
        </Link>
      ))}
    </p>
  );
}
