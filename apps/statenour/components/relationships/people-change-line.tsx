"use client";

/**
 * PeopleChangeLine · "since your last visit" for /people · 2026-09-16.
 * The ChangeSet primitive's third consumer: its own cursor
 * (`nour:people-last-visit`), the `task.peopleChangesSince` read, the shared
 * line. Sits above Nick's brief, which answers "who today" — a different
 * question from "what moved while you were away".
 */

import { trpc } from "@/lib/trpc/client";
import { useChangeCursor, useSettleChangeCursor } from "@/hooks/use-change-cursor";
import { ChangeSetLine } from "@/components/ui/change-set-line";

export function PeopleChangeLine() {
  const cursor = useChangeCursor("people");
  const q = trpc.task.peopleChangesSince.useQuery(
    { since: cursor },
    { enabled: cursor > 0, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  useSettleChangeCursor("people", cursor, q.isSuccess);

  if (cursor === 0) return null;
  return (
    <ChangeSetLine
      set={q.data}
      status={q.isError ? "error" : q.isSuccess ? "ready" : "loading"}
      className="border-b border-edge pb-3"
    />
  );
}
