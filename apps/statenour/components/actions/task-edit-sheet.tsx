"use client";

/**
 * TaskEditSheet · v10.0.327 · centered modal shell for task-edit pickers.
 *
 * Stage C of the /tasks decomposition campaign. The page had TWO inline
 * modal sheets (goal-edit + project-edit · v10.0.146 PROJECT-EDIT was the
 * twin of the v10.0.137 GOAL-EDIT). Both shared the same shell:
 *
 *   · fixed inset backdrop with click-to-close + blur
 *   · centered rounded card with shadow
 *   · title row (eyebrow uppercase + task title + ✕ button)
 *   · picker children below
 *
 * Extraction collapses the duplicated chrome to one component · the page
 * passes the picker (LinkGoalPicker / LinkProjectPicker) as children with
 * its own logic intact. Net -76 LOC across the 2 inline call-sites.
 *
 * Why a shell rather than a generic Modal: every task-axis edit modal
 * shares this exact shape · breaking out a tighter primitive avoids the
 * temptation to over-generalize a Dialog/Drawer/Modal into something the
 * codebase doesn't otherwise need.
 */

import type { ReactNode } from "react";

interface TaskEditSheetProps {
  /** When true, render the sheet · false renders nothing. */
  isOpen: boolean;
  /** Called when the user clicks the backdrop or the ✕ button. */
  onClose: () => void;
  /** Tiny breadcrumb-style label above the title. e.g. "Change linked goal". */
  eyebrow: string;
  /** The task's own title · truncated if long. */
  taskTitle: string;
  /** The picker (LinkGoalPicker / LinkProjectPicker) with its own props bound. */
  children: ReactNode;
}

export function TaskEditSheet({
  isOpen,
  onClose,
  eyebrow,
  taskTitle,
  children,
}: TaskEditSheetProps) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="rounded-xl border border-zinc-700/60 bg-zinc-950 shadow-[0_8px_32px_rgba(0,0,0,0.7)] p-3 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
              {eyebrow}
            </p>
            <p className="text-[11px] text-zinc-200 mt-0.5 truncate">
              {taskTitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-200 shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
