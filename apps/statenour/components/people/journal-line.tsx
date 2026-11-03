/**
 * The /people journal lines (W4, 2026-11-02): the newest journal entry naming a person, and the one status line that
 * says the journal read failed. Split out of app/(mastery)/people/page.tsx so both states are testable.
 */
import Link from "next/link";
import { etDaysBetween } from "@/lib/brain/goal-pace";

export function JournalReadStatus({ reads }: { reads: { journal: "ok" | "failed" } | undefined }) {
  if (reads?.journal !== "failed") return null;
  return (
    <p role="status" className="mt-2 text-[13px] text-amber-200">
      Journal lines couldn&apos;t load. What you wrote about people is unknown here, not empty.
    </p>
  );
}

export function PersonJournalLine({
  latestJournal,
  formatDays,
}: {
  latestJournal: { at: string; excerpt: string; dumpId: string } | null | undefined;
  /** The page's own "3d ago" formatter, so this line reads like the note line above it. */
  formatDays: (days: number) => string;
}) {
  if (!latestJournal) return null;
  return (
    <p className="mt-1 text-[12px] text-fg-tertiary line-clamp-2">
      {/* W8b: a tap opens the entry itself (the feed anchors each entry as bd-<id>); the row's own click is stopped. */}
      <Link
        href={`/journal#bd-${latestJournal.dumpId}`}
        onClick={(e) => e.stopPropagation()}
        className="underline-offset-4 hover:text-fg hover:underline"
      >
        Journal, {formatDays(Math.max(0, etDaysBetween(Date.parse(latestJournal.at), Date.now())))}:{" "}
        {latestJournal.excerpt}
      </Link>
    </p>
  );
}
