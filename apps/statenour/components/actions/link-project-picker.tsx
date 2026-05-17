"use client";

/**
 * LinkProjectPicker — modal sheet that lets Nour move a task onto a
 * different project (Mission). Mirrors LinkGoalPicker's role for the
 * project axis.
 *
 * Why this exists (v10.0.146 · May 02):
 *   Until now the only way to change a task's project from /tasks was
 *   to delete + re-create the task, or to "leave project" (which sends
 *   missionId: null). There was no UI to LINK an Inbox task to a real
 *   project. Nour flagged it after the tab rename pass — a task could
 *   sit forever in Inbox with no affordance to relocate it. The picker
 *   plugs that gap by offering a one-tap "move this task to Project X"
 *   on every expanded row.
 *
 * Behavior:
 *   · Pick a project   → PATCH /api/tasks/:id { missionId }
 *   · Tap "✓ current"  → no-op (current is rendered but disabled)
 *   · Tap "↗ leave"    → PATCH /api/tasks/:id { missionId: null }
 *
 * Active projects only — paused/done/archived are filtered out of the
 * list because Nour's intent is always "move this to a live project."
 * Empty-state copy nudges him to create a project from PLAN mode.
 *
 * NOTE the Mission schema is nullable on Task.missionId; "leave"
 * really does clear it. The historical "Inbox" pseudo-mission isn't
 * involved here — that was a server-side default when missionId was
 * empty during create, not a relink target.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Briefcase, X } from "lucide-react";
import { toast } from "sonner";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { notifyDataChanged } from "@/lib/events/data-change";

export interface ProjectPickerOption {
  id: string;
  title: string;
  status?: string;
  domain?: string | null;
}

interface LinkProjectPickerProps {
  taskId: string;
  taskTitle: string;
  projects: ProjectPickerOption[];
  /** Current project id (renders as "✓ current"; clicking is a no-op). */
  currentProjectId?: string | null;
  /** Show the "leave project" affordance at the top. */
  allowLeave?: boolean;
  /** Fires after a successful PATCH so the parent can re-fetch. */
  onLinked?: () => void;
  /** Fires on close (outside click or after success). */
  onClose?: () => void;
}

export function LinkProjectPicker({
  taskId,
  taskTitle,
  projects,
  currentProjectId = null,
  allowLeave = false,
  onLinked,
  onClose,
}: LinkProjectPickerProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // Outside-click closes the sheet. Parent owns the visibility flag —
  // we just notify on close so it can clear its edit state.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose?.();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  // Filter to active projects only — the picker is for relocation, so
  // moving a task to a paused/done project doesn't fit any real flow.
  // (If Nour does want to revive a paused project, he does that from
  // PLAN mode where the project card itself lives.)
  const activeProjects = projects.filter(
    (p) => !p.status || p.status === "ACTIVE" || p.status === "active",
  );

  const handleLink = async (project: ProjectPickerOption) => {
    if (project.id === currentProjectId) return;
    setBusyId(project.id);
    try {
      const r = await authedFetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: project.id }),
      });
      if (r.ok) {
        toast.success(
          `Moved to "${project.title.slice(0, 40)}"`,
        );
        // Cross-surface notify — task left its old project + joined a
        // new one, so both project views need to refresh as does the
        // NOW stream's mission breadcrumb.
        notifyDataChanged("tasks", {
          source: "link-project-picker",
          detail: "link",
          id: taskId,
        });
        notifyDataChanged("projects", {
          source: "link-project-picker",
          detail: "link",
          id: project.id,
        });
        notifyDataChanged("missions", {
          source: "link-project-picker",
          detail: "link",
          id: project.id,
        });
        onLinked?.();
      } else {
        toast.error("Move failed");
      }
    } catch (e) {
      toast.error(`Move failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusyId(null);
      onClose?.();
    }
  };

  const handleLeave = async () => {
    setBusyId("__leave__");
    try {
      const r = await authedFetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId: null }),
      });
      if (r.ok) {
        toast.success("Removed from mission");
        notifyDataChanged("tasks", {
          source: "link-project-picker",
          detail: "leave",
          id: taskId,
        });
        notifyDataChanged("projects", {
          source: "link-project-picker",
          detail: "leave",
        });
        onLinked?.();
      } else {
        toast.error("Couldn't remove");
      }
    } catch (e) {
      toast.error(`Remove failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusyId(null);
      onClose?.();
    }
  };

  if (!projects || activeProjects.length === 0) {
    return (
      <div
        ref={ref}
        className="rounded-lg border border-zinc-700/60 bg-zinc-950 overflow-hidden"
      >
        <div className="px-2.5 py-1.5 border-b border-zinc-800/50">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400 flex items-center gap-1">
            <Briefcase size={9} />
            no active missions
          </span>
        </div>
        <p className="px-2.5 py-3 text-[10px] text-zinc-600 italic">
          Create a mission first on the goals tab → New mission.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="rounded-lg border border-zinc-700/60 bg-zinc-950 overflow-hidden"
    >
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-zinc-800/50">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400 flex items-center gap-1">
          <Briefcase size={9} />
          {currentProjectId ? "switch mission" : "pick a mission"}
        </span>
      </div>

      {/* Leave-project affordance — only when Nour is currently in a
          project and the parent allows it (allowLeave=true). Sends
          missionId: null which the API accepts. */}
      {allowLeave && currentProjectId && (
        <button
          onClick={() => void handleLeave()}
          disabled={busyId !== null}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-amber-300 hover:bg-amber-500/10 transition-colors border-b border-zinc-800/40 disabled:opacity-50"
          title={`Remove "${taskTitle}" from its current mission`}
        >
          {busyId === "__leave__" ? (
            <Loader2 size={10} className="animate-spin text-amber-400 shrink-0" />
          ) : (
            <X size={10} className="text-amber-400 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider truncate">
              ↗ leave mission
            </p>
            <p className="text-[9px] text-zinc-500 truncate">
              keeps the task, clears the link
            </p>
          </div>
        </button>
      )}

      <div className="max-h-[240px] overflow-y-auto py-1">
        {activeProjects.map((p) => {
          const isCurrent = p.id === currentProjectId;
          return (
            <button
              key={p.id}
              onClick={() => !isCurrent && handleLink(p)}
              disabled={busyId !== null || isCurrent}
              className={cn(
                "w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-900 transition-colors",
                busyId === p.id && "opacity-60",
                isCurrent && "bg-blue-500/5 cursor-default",
              )}
            >
              {busyId === p.id ? (
                <Loader2 size={10} className="animate-spin text-blue-400 shrink-0" />
              ) : (
                <Briefcase
                  size={10}
                  className={cn(
                    isCurrent ? "text-blue-300" : "text-blue-400",
                    "shrink-0",
                  )}
                />
              )}
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "text-[11px] truncate",
                    isCurrent ? "text-blue-200 font-bold" : "text-zinc-200",
                  )}
                >
                  {p.title}
                </p>
                {p.domain && (
                  <p className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">
                    {p.domain}
                  </p>
                )}
              </div>
              {isCurrent && (
                <span className="text-[7px] font-mono uppercase tracking-wider text-blue-400/80 shrink-0">
                  current
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="px-2.5 py-1 border-t border-zinc-800/50 text-[8px] text-zinc-600">
        moves 1 task
      </div>
    </div>
  );
}
