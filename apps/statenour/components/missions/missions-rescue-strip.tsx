"use client";

/**
 * MissionsRescueStrip · Wire 2 · 2026-06-09.
 *
 * Read-only triage strip on /missions: surfaces the task-rescue suggestions
 * (misfiled / stale / low-confidence — from buildTaskRescue) and the GENERAL
 * domain-anchor open-counts (so the classifier's catch-all anchors aren't
 * invisible inboxes). Suggestions only — NEVER moves a task. Mounted under
 * MissionsHealthStrip.
 */

import { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

const ISSUE_LABEL: Record<string, string> = {
  pending_classification: "needs approval",
  legacy_inbox: "in legacy inbox",
  stale: "stale",
  no_next_action: "no next action",
  general_maybe_specific: "maybe a project?",
};

export function MissionsRescueStrip() {
  const [open, setOpen] = useState(false);
  const { data } = trpc.task.missionsHygiene.useQuery(undefined, {
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  if (!data) return null;

  const findings = data.rescue.findings;
  const anchors = data.anchors.filter((a) => a.openCount > 0);
  if (findings.length === 0 && anchors.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-500/15 bg-zinc-950/40 px-4 py-3 text-sm">
      {findings.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-2 text-left text-amber-200/90"
          >
            <LifeBuoy className="h-4 w-4 shrink-0" />
            <span className="font-medium tracking-wide">
              {findings.length} task{findings.length === 1 ? "" : "s"} need attention
            </span>
            <span className="ml-auto text-xs text-zinc-500">{open ? "hide" : "show"}</span>
          </button>
          {open && (
            <ul className="mt-2 space-y-1.5">
              {findings.slice(0, 8).map((f) => (
                <li
                  key={f.taskId}
                  className="flex flex-col gap-0.5 border-l-2 border-amber-500/20 pl-2"
                >
                  <span className="text-zinc-200">
                    <span className="mr-1.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300/80">
                      {ISSUE_LABEL[f.issue] ?? f.issue}
                    </span>
                    {f.title}
                  </span>
                  <span className="text-xs text-zinc-500">{f.suggestedFix}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {anchors.length > 0 && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500",
            findings.length > 0 && "mt-3 border-t border-zinc-800/60 pt-2",
          )}
        >
          <span className="uppercase tracking-wide text-zinc-600">Domain anchors</span>
          {anchors.map((a) => (
            <span key={a.missionId} className="text-zinc-400">
              {a.title} <span className="text-amber-300/70">{a.openCount}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
