"use client";

/**
 * TASK ROW — Shared row component for both Task and NickTask.
 *
 * Renders a complete-button, title, next-action subtitle, mission/domain
 * badge, effort + context + age, and a dropdown menu with Pin / Start /
 * Done / Delete. Hover reveals the menu.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Circle,
  CheckCircle2,
  ArrowRight,
  Timer,
  Zap,
  MoreVertical,
  Pin,
  Play,
  Trash2,
  Link2,
  HelpCircle,
} from "lucide-react";
import { CONTEXT_ICON, EFFORT_LABEL, domainClass } from "./shared";

interface TaskRowProps {
  title: string;
  subtitle?: string;
  mission?: { title: string; domain: string };
  /** Apr 20 bridge: the LifeGoal title this task is serving (via
   *  Task.goalId). When set, the row renders an ancestry chip line
   *  above the WHY so Nour sees Goal → Project → Task lineage on
   *  every row without expanding anything. */
  goalTitle?: string | null;
  domain?: string;
  effort?: string;
  context?: string;
  age?: string;
  isOverdue?: boolean;
  isDoing?: boolean;
  source?: string;
  /** BrainDump ID if this task was spawned by the journal pipeline.
   *  When set, the row shows a "from journal" link that opens /journal
   *  scrolled to the source entry. */
  sourceBrainDumpId?: string | null;
  isPinned?: boolean;
  onComplete: () => void;
  onStart?: () => void;
  onDelete: () => void;
  onPin?: () => void;
  /** v10.0.421 · operator can rename the task inline.
   *  Parent owns persistence (PATCH /api/tasks/[id]) so this hook
   *  just receives the new title string and returns when the
   *  server-side save resolves. Optional · row stays read-only
   *  when not provided. */
  onRename?: (newTitle: string) => Promise<void>;
}

export function TaskRow({
  title,
  subtitle,
  mission,
  goalTitle,
  domain,
  effort,
  context,
  age,
  isOverdue,
  isDoing,
  source,
  sourceBrainDumpId,
  isPinned,
  onComplete,
  onStart,
  onDelete,
  onPin,
  onRename,
}: TaskRowProps) {
  // v10.0.421 · inline rename state · only active when onRename is wired
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [savingTitle, setSavingTitle] = useState(false);

  async function commitRename() {
    if (!onRename) return;
    const next = draftTitle.trim();
    if (next.length === 0 || next === title) {
      setIsRenaming(false);
      setDraftTitle(title);
      return;
    }
    setSavingTitle(true);
    try {
      await onRename(next);
      setIsRenaming(false);
    } catch {
      // parent toasts the error · we just exit edit mode
      setIsRenaming(false);
      setDraftTitle(title);
    } finally {
      setSavingTitle(false);
    }
  }
  const dm = mission?.domain || domain;
  // Why chain — surface the mission link (the closest thing to a goal
  // on the current schema). Tasks with no real mission (default Inbox)
  // show a muted unlinked nudge — UNLESS the task has a source field
  // (meaning it came from the journal pipeline, chat, or an engine),
  // in which case the source IS the "why" and the unlinked prompt is
  // noise.
  const missionTitle = mission?.title?.trim();
  const hasExplicitSource = !!source && source.length > 0;
  const isUnlinked =
    (!missionTitle || missionTitle.toLowerCase() === "inbox") &&
    !hasExplicitSource;

  return (
    <div
      className={cn(
        "flex items-start gap-2 p-2 rounded-lg border transition-all group",
        "bg-zinc-900/20 border-zinc-800/30 hover:border-zinc-700/40",
        isOverdue && "border-l-2 border-l-red-500/40",
        isDoing && "border-l-2 border-l-blue-500/40 bg-blue-500/5"
      )}
    >
      <button
        onClick={onComplete}
        className="mt-0.5 shrink-0 text-zinc-700 hover:text-emerald-400 transition-colors"
        title="Complete"
      >
        <Circle size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          {isRenaming ? (
            // v10.0.421 · inline rename · enter saves · escape cancels
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitRename();
                } else if (e.key === "Escape") {
                  setIsRenaming(false);
                  setDraftTitle(title);
                }
              }}
              disabled={savingTitle}
              autoFocus
              className="flex-1 min-w-0 bg-zinc-900 border border-amber-500/40 rounded px-2 py-1 text-[12px] font-medium text-[var(--text-primary)] focus:outline-none focus:border-amber-500"
            />
          ) : (
            <span
              className={`text-[12px] font-medium text-[var(--text-primary)] ${onRename ? "cursor-text hover:bg-zinc-800/40 rounded px-1 -mx-1" : ""}`}
              onClick={() => {
                if (onRename) {
                  setDraftTitle(title);
                  setIsRenaming(true);
                }
              }}
              title={onRename ? "Click to rename" : undefined}
            >
              {title}
            </span>
          )}
          {isDoing && (
            <Badge className="bg-blue-500/15 text-blue-400 text-[7px] h-3">DOING</Badge>
          )}
          {isOverdue && <span className="text-[8px] text-red-400 font-bold">⚠️</span>}
          {source && (
            sourceBrainDumpId ? (
              <a
                href={`/journal#bd-${sourceBrainDumpId}`}
                className="inline-flex items-center gap-0.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[7px] h-3 px-1 rounded transition-colors"
                title="Open source journal entry"
                onClick={(e) => e.stopPropagation()}
              >
                <Zap size={7} />
                {source}
              </a>
            ) : (
              <Badge className="bg-amber-500/10 text-amber-400 text-[7px] h-3 gap-0.5">
                <Zap size={7} />
                {source}
              </Badge>
            )
          )}
        </div>
        {subtitle && (
          <p className="text-[10px] text-zinc-500 mt-0.5 flex items-start gap-0.5">
            <ArrowRight size={8} className="text-amber-500/50 mt-0.5 shrink-0" />
            {subtitle}
          </p>
        )}
        {/* Apr 20 ancestry — Goal → Project lineage. Rendered only
            when this task carries a goalId resolved to a real title.
            Purple chip to distinguish from the amber mission WHY. */}
        {goalTitle && (
          <p className="text-[9px] text-violet-400/70 mt-0.5 flex items-center gap-1">
            <span className="uppercase tracking-wider text-[7px] font-bold text-violet-400/50 shrink-0">
              goal
            </span>
            <span className="truncate">{goalTitle}</span>
          </p>
        )}
        {/* WHY chain — trace to mission (strategic anchor) */}
        {isUnlinked ? (
          <p
            className="text-[9px] text-zinc-700 mt-0.5 flex items-center gap-1 italic"
            title="Link this task to a mission to make it count"
          >
            <HelpCircle size={8} className="shrink-0" />
            unlinked — why are you doing this?
          </p>
        ) : (
          <p className="text-[9px] text-amber-500/60 mt-0.5 flex items-center gap-1">
            <Link2 size={8} className="shrink-0" />
            <span className="uppercase tracking-wider text-[7px] font-bold text-amber-500/40">
              why
            </span>
            <span className="truncate">{missionTitle}</span>
          </p>
        )}
        <div className="flex items-center gap-1.5 mt-0.5">
          {dm && (
            <Badge className={cn("text-[7px] h-3", domainClass(dm))}>
              {mission?.title || dm}
            </Badge>
          )}
          {effort && EFFORT_LABEL[effort] && (
            <span className="text-[8px] text-zinc-600">
              <Timer size={7} className="inline" /> {EFFORT_LABEL[effort]}
            </span>
          )}
          {context && CONTEXT_ICON[context] && (
            <span className="text-[8px]">{CONTEXT_ICON[context]}</span>
          )}
          {age && <span className="text-[8px] text-zinc-700 font-mono">{age}</span>}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Task actions menu"
          className="text-zinc-700 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center p-3 -m-3 min-w-[36px] min-h-[36px] rounded-full focus-visible:relative focus-visible:z-10"
        >
          <MoreVertical size={13} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 min-w-[100px]">
          {onPin && (
            <DropdownMenuItem onClick={onPin} className="text-xs gap-1.5 cursor-pointer text-amber-400">
              <Pin size={10} />
              {isPinned ? "Unpin" : "Pin to top"}
            </DropdownMenuItem>
          )}
          {onStart && (
            <DropdownMenuItem onClick={onStart} className="text-xs gap-1.5 cursor-pointer text-zinc-300">
              <Play size={10} />
              Start
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onComplete} className="text-xs gap-1.5 cursor-pointer text-zinc-300">
            <CheckCircle2 size={10} />
            Done
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="text-xs gap-1.5 cursor-pointer text-red-400">
            <Trash2 size={10} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Small metric helper shared with the daily-pulse section.
export function Metric({
  n,
  label,
  color,
  alert,
}: {
  n: number;
  label: string;
  color: string;
  alert?: boolean;
}) {
  return (
    <div className={cn("text-center min-w-[40px]", alert && "animate-pulse")}>
      <p className={cn("text-lg font-bold leading-none tracking-tight", color)}>{n}</p>
      <p className="text-[7px] text-zinc-600 font-semibold uppercase tracking-widest mt-0.5">
        {label}
      </p>
    </div>
  );
}
