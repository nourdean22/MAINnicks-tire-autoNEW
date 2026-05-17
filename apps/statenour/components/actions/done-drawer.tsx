"use client";

/**
 * DoneDrawer · v10.0.329 · the collapsed-by-default completed-tasks
 * drawer for /tasks.
 *
 * Stage C.3 of the /tasks decomposition. ~70 LOC of inline JSX → 1
 * typed component call. Encapsulates:
 *   · Header button · Eye/EyeOff toggle + count chips (today/yest/week)
 *   · Drawer body when expanded · grouped by recency (Today / Yesterday
 *     / This Week / Older), each group with accent color + count badge
 *   · Per-row · checkmark + line-through title + relative time + hover-
 *     reveal trash button
 *
 * doneGroups is computed in the parent (parent owns the tasks state) ·
 * the component is pure UI with show/hide state passed in.
 *
 * Older items capped at 10 to keep the DOM bounded · the page can lift
 * that cap via a separate "view all done" surface if Nour ever wants
 * full archive UX.
 */

import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, CheckCircle2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ageLabel as ag, type Task } from "@/components/actions/shared";

export interface DoneGroups {
  today: Task[];
  yest: Task[];
  week: Task[];
  older: Task[];
}

interface DoneDrawerProps {
  /** When false, the drawer is fully hidden (no header). */
  visible: boolean;
  /** Whether the drawer body is expanded. */
  showDone: boolean;
  /** Toggle the body expanded/collapsed. */
  onToggle: () => void;
  /** Pre-grouped done tasks (today / yesterday / this week / older). */
  doneGroups: DoneGroups;
  /** Delete a row · used by per-row trash button. */
  onDelete: (id: string) => void | Promise<void>;
}

export function DoneDrawer({
  visible,
  showDone,
  onToggle,
  doneGroups,
  onDelete,
}: DoneDrawerProps) {
  if (!visible) return null;
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 text-[9px] text-zinc-700 hover:text-zinc-400"
      >
        {showDone ? <EyeOff size={9} /> : <Eye size={9} />}
        {showDone ? "Hide" : "Show"} completed
        <span className="text-zinc-800">·</span>
        <span className="text-emerald-400">{doneGroups.today.length}</span>
        <span className="text-zinc-800">today</span>
        <span className="text-zinc-800">·</span>
        <span className="text-zinc-500">{doneGroups.yest.length}</span>
        <span className="text-zinc-800">yest</span>
        <span className="text-zinc-800">·</span>
        <span className="text-zinc-500">{doneGroups.week.length}</span>
        <span className="text-zinc-800">wk</span>
      </button>
      {showDone && (
        <div className="mt-2 space-y-3">
          {(
            [
              { label: "Today", items: doneGroups.today, accent: "text-emerald-400" },
              { label: "Yesterday", items: doneGroups.yest, accent: "text-emerald-500/70" },
              { label: "This Week", items: doneGroups.week, accent: "text-zinc-500" },
              { label: "Older", items: doneGroups.older.slice(0, 10), accent: "text-zinc-600" },
            ] as const
          ).map((group) => {
            if (group.items.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="flex items-center gap-2 mb-1 px-1">
                  <span
                    className={cn(
                      "text-[9px] font-bold uppercase tracking-wider",
                      group.accent
                    )}
                  >
                    {group.label}
                  </span>
                  <Badge className="bg-zinc-800/50 text-zinc-500 text-[8px] h-3.5 font-mono">
                    {group.items.length}
                  </Badge>
                </div>
                {group.items.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 py-1 px-1 text-zinc-600 text-[11px] group"
                  >
                    <CheckCircle2 size={11} className="text-emerald-700" />
                    <span className="line-through flex-1">{t.title}</span>
                    <span className="text-[8px] font-mono">
                      {ag(t.updatedAt || t.lastTouchedAt)}
                    </span>
                    <button
                      onClick={() => onDelete(t.id)}
                      aria-label={`Permanently delete · ${t.title}`}
                      title="Permanently delete"
                      type="button"
                      className="opacity-0 group-hover:opacity-100 text-zinc-700 hover:text-red-400 inline-flex items-center justify-center p-3 -m-3 min-w-[36px] min-h-[36px] rounded-full transition-opacity focus-visible:relative focus-visible:z-10"
                    >
                      <Trash2 size={9} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
