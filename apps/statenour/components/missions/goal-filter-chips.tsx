"use client";

/**
 * The goal filter row on /missions (job 2026-11-02-nour-os-interconnect W3).
 * One chip per goal with linked work (lib/missions/task-goal goalFilterOptions);
 * the URL `?goalId=` is the filter state, so a chip is a link and the goal card can
 * deep-link here. Renders nothing when no goal has linked work.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import { GOAL_CHIP_WIDTH, goalFilterHref } from "@/lib/missions/task-goal";

export function GoalFilterChips({
  options,
  selectedId,
  goalsRead,
}: {
  options: { id: string; title: string }[];
  selectedId: string | null;
  goalsRead: "ok" | "loading" | "failed";
}) {
  if (options.length === 0) {
    return goalsRead === "failed" ? (
      <p className="font-mono text-[11px] text-fg-tertiary">goal titles not read this pass</p>
    ) : null;
  }
  return (
    <nav aria-label="filter by goal" className="flex flex-wrap items-center gap-2">
      <span className="vt-eyebrow text-fg-tertiary">goals</span>
      {options.map((o) => {
        const on = o.id === selectedId;
        return (
          <Link
            key={o.id}
            href={goalFilterHref(on ? null : o.id)}
            replace
            scroll={false}
            aria-current={on ? "true" : undefined}
            title={on ? `Showing ${o.title}: tap to show every goal` : `Show only work toward ${o.title}`}
            className={cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border px-3 font-mono text-[11px] transition-colors duration-[var(--motion-state)]",
              GOAL_CHIP_WIDTH,
              on ? "border-sky-300/60 text-sky-200" : "border-edge-default text-sky-300 hover:border-edge-strong",
            )}
          >
            <span className="truncate">{o.title}</span>
          </Link>
        );
      })}
      {goalsRead === "failed" && <span className="font-mono text-[11px] text-fg-tertiary">goal titles not read this pass</span>}
    </nav>
  );
}
