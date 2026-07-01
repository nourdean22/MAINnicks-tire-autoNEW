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
import type { Task } from "@/components/actions/shared";
import { MissionTaskRow } from "./mission-task-row";

const ISSUE_LABEL: Record<string, string> = {
  pending_classification: "Pending Classification",
  legacy_inbox: "Legacy Inbox",
  stale: "Stale",
  no_next_action: "No Next Action",
  general_maybe_specific: "General Anchor",
};

export interface MissionsRescueStripProps {
  tasks?: Task[];
}

export function MissionsRescueStrip({
  tasks,
}: MissionsRescueStripProps) {
  const [open, setOpen] = useState(false);
  const [expandedAnchorId, setExpandedAnchorId] = useState<string | null>(null);
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
            "flex flex-col gap-2 text-xs text-zinc-500",
            findings.length > 0 && "mt-3 border-t border-zinc-800/60 pt-2",
          )}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="uppercase tracking-wide text-zinc-600">Domain anchors</span>
            {anchors.map((a) => {
              const isExpanded = expandedAnchorId === a.missionId;
              return (
                <button
                  key={a.missionId}
                  type="button"
                  onClick={() => setExpandedAnchorId(isExpanded ? null : a.missionId)}
                  className={cn(
                    "text-zinc-400 hover:text-[var(--gold)] transition-colors inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-transparent font-medium",
                    isExpanded && "bg-zinc-800/60 border-zinc-700/50 text-[var(--gold)]"
                  )}
                >
                  {a.title} <span className="text-amber-300/70">{a.openCount}</span>
                </button>
              );
            })}
          </div>

          {/* Expanded Anchor Tasks */}
          {expandedAnchorId && tasks && (
            <div className="mt-2 rounded-xl border border-zinc-800/60 bg-zinc-950/20 p-2 space-y-1">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500 font-mono flex items-center justify-between">
                <span>Tasks in {anchors.find((a) => a.missionId === expandedAnchorId)?.title || "Anchor"}</span>
                <button
                  type="button"
                  onClick={() => setExpandedAnchorId(null)}
                  className="text-zinc-600 hover:text-zinc-400 font-medium"
                >
                  close
                </button>
              </div>
              {(() => {
                const anchorTasks = tasks.filter(
                  (t) =>
                    t.missionId === expandedAnchorId &&
                    t.status !== "DONE" &&
                    t.status !== "ARCHIVED"
                );
                if (anchorTasks.length === 0) {
                  return (
                    <div className="px-2 py-3 text-center text-zinc-600 font-mono text-[11px]">
                      No open tasks in this anchor.
                    </div>
                  );
                }
                return (
                  <div className="divide-y divide-zinc-800/30">
                    {anchorTasks.map((task) => (
                      <MissionTaskRow
                        key={task.id}
                        task={task}
                      />
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
