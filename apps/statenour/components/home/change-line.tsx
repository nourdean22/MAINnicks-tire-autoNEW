"use client";

/**
 * ChangeLine — section 6: "since last visit" as a semantic diff, one line.
 * Replaces SinceLastVisitCard's 20-row audit timeline: the operator should
 * not inspect system history to discover change — the system interprets
 * the history (operator.briefChanges runs REAL domain queries server-side;
 * lib/home/operator-brief.ts documents which).
 *
 * 2026-09-15 (wave 3): the cursor rules and the sentence moved to the
 * ChangeSet primitive (lib/ui/change-cursor.ts · hooks/use-change-cursor.ts
 * · components/ui/change-set-line.tsx) so Brain's Changed view could be the
 * second consumer. Same storage key ("nour:hq-last-visit" = cursorKey("hq")),
 * same settle rule, same markup; localStorage is still read only inside
 * effects (home-hydration-safety).
 */

import { trpc } from "@/lib/trpc/client";
import { useChangeCursor, useSettleChangeCursor } from "@/hooks/use-change-cursor";
import { ChangeSetLine } from "@/components/ui/change-set-line";

export function ChangeLine() {
  const cursor = useChangeCursor("hq");
  const changesQ = trpc.operator.briefChanges.useQuery(
    { since: cursor },
    { enabled: cursor > 0, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  useSettleChangeCursor("hq", cursor, changesQ.isSuccess);

  if (cursor === 0) return null;
  return (
    <ChangeSetLine
      set={changesQ.data}
      status={changesQ.isError ? "error" : changesQ.isSuccess ? "ready" : "loading"}
      link={{ href: "/system", label: "Activity →" }}
    />
  );
}
