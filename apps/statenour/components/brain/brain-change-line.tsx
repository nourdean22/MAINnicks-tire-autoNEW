"use client";

/**
 * BrainChangeLine · "since your last visit" for the Brain Changed view ·
 * 2026-09-15 (wave 3). The ChangeSet primitive's second consumer: its own
 * cursor (`nour:brain-last-visit`), the `brain.changesSince` read, the
 * shared line. Sits above the 24h buckets, which answer a different question.
 */

import { trpc } from "@/lib/trpc/client";
import { useChangeCursor, useSettleChangeCursor } from "@/hooks/use-change-cursor";
import { ChangeSetLine } from "@/components/ui/change-set-line";

export function BrainChangeLine() {
  const cursor = useChangeCursor("brain");
  const q = trpc.brain.changesSince.useQuery(
    { since: cursor },
    { enabled: cursor > 0, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  useSettleChangeCursor("brain", cursor, q.isSuccess);

  if (cursor === 0) return null;
  return (
    <ChangeSetLine
      set={q.data}
      status={q.isError ? "error" : q.isSuccess ? "ready" : "loading"}
      className="border-b border-edge pb-3"
    />
  );
}
