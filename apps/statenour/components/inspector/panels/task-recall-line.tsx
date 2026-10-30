"use client";

/**
 * The recall line · 2026-10-29 (benchmark pick 2, Rosebud / Jarvis). One
 * mono line under the title: the newest thing recorded about the task's
 * person, with its age and source so it can be judged. Nothing when the task
 * has no person; "lookup failed" when the read failed (never blank).
 */

import { trpc } from "@/lib/trpc/client";
import { formatAge } from "@/lib/ui/metric-datum";

export function TaskRecallLine({ taskId }: { taskId: string }) {
  const q = trpc.task.recallLine.useQuery({ taskId }, { staleTime: 60_000, retry: 1 });
  if (q.isLoading) return null;
  if (q.isError) {
    return <p className="font-mono text-[12px] text-amber-300" data-recall-line="error">memory lookup failed</p>;
  }
  const r = q.data;
  if (!r || r.state === "none") return null;
  if (r.state === "empty") {
    return (
      <p className="font-mono text-[12px] text-fg-tertiary" data-recall-line="empty">
        {r.personName} · nothing recorded yet
      </p>
    );
  }
  return (
    <p className="font-mono text-[12px] leading-snug text-fg-secondary" data-recall-line="line">
      {r.personName} · {formatAge(new Date(r.at), new Date())} · {r.source}: {r.note}
    </p>
  );
}
