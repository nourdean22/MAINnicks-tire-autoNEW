"use client";

/**
 * /journal?entry=<id> (W8b): the one entry a link names, whatever its age. The feed holds the newest page only, so a
 * bare #bd-<id> anchor missed anything older. A failed read is unknown; a missing entry says so; neither is empty.
 */
import { useEffect, useRef, useState } from "react";

import { JournalEntryRow } from "@/components/journal/entry-row";
import type { FeedEntry } from "@/components/journal/types";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { trpc } from "@/lib/trpc/client";

export function LinkedEntryView({ read }: { read: FeedEntry | null | "loading" | "failed" }) {
  const [open, setOpen] = useState(true);
  if (read === "loading") {
    return (
      <div aria-busy="true">
        <ShimmerSkeleton className="h-20 rounded-surface border border-edge-subtle" />
      </div>
    );
  }
  if (read === "failed") return <p role="status" className="text-[13px] text-amber-300">That entry couldn&apos;t load. State unknown, not missing.</p>;
  if (read === null) return <p role="status" className="text-[13px] text-fg-tertiary">That entry wasn&apos;t found. It may have been deleted.</p>;
  return <JournalEntryRow entry={read} isExpanded={open} onToggle={() => setOpen((o) => !o)} delay={0} />;
}

export function LinkedEntry({ id }: { id: string }) {
  const q = trpc.journal.entry.useQuery({ id }, { refetchOnWindowFocus: false });
  const settled = q.data !== undefined || q.isError;
  const box = useRef<HTMLDivElement>(null);
  // The browser's own hash jump ran before this row existed.
  useEffect(() => {
    if (settled) box.current?.scrollIntoView({ block: "start" });
  }, [settled, id]);
  return (
    <div ref={box} className="scroll-mt-24">
      <LinkedEntryView read={q.data !== undefined ? q.data : q.isError ? "failed" : "loading"} />
    </div>
  );
}
