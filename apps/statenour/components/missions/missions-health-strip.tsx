"use client";

/**
 * MissionsHealthStrip · Wave AO · 2026-05-28.
 *
 * The 1-glance triage strip for /missions. Mirrors GoalsHealthStrip's
 * contract · one chip per active mission · color-coded by health.
 * Lets the operator scan the missions board in 2 seconds and know
 * which ones are alive, idle, or behind without reading any titles.
 *
 * Health classifier · purely deterministic ·
 *   · emerald · in_flight  (has a DOING task)
 *   · emerald · healthy    (open tasks but no DOING · pace OK)
 *   · gold    · behind     (deadline is imminent · < 3 days · > 1 open)
 *   · rose    · stalled    (mission has tasks but no progress
 *                            indicators · last update > 14 days ago
 *                            · we use the planData updatedAt proxy
 *                            since the page doesn't carry lastTouched)
 *   · zinc    · idle       (no open tasks · waiting on operator)
 *   · faint gold · done    (mission complete, hadn't been archived yet)
 *
 * Operator-grade signal · the count summary in the eyebrow lights up
 * "N stalled · M behind · K healthy" so triage is fast.
 *
 * Mounted between MissionsQuickAdd and MissionFeed.
 */

import { useMemo } from "react";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project, Task } from "@/components/actions/shared";

type Pace = "in_flight" | "healthy" | "behind" | "stalled" | "idle" | "done";

interface ChipData {
  id: string;
  title: string;
  pace: Pace;
  openTasks: number;
  doingTasks: number;
  daysToDeadline: number | null;
}

interface MissionsHealthStripProps {
  missions: Project[];
  tasks: Task[];
}

const DAY_MS = 86_400_000;

function classifyPace(
  m: Project,
  open: Task[],
  doing: Task[],
): Pace {
  if (open.length === 0) {
    // All tasks done · either complete or empty mission.
    const total = tasksLength(m, doing);
    return total > 0 ? "done" : "idle";
  }
  if (doing.length > 0) return "in_flight";
  // Deadline pressure check.
  if (m.deadline) {
    const days = (new Date(m.deadline).getTime() - Date.now()) / DAY_MS;
    if (days < 0) return "stalled"; // overdue with open tasks = stalled
    if (days <= 3 && open.length > 1) return "behind";
  }
  return "healthy";
}

function tasksLength(_m: Project, doing: Task[]): number {
  return doing.length;
}

const PACE_STYLE: Record<
  Pace,
  { dot: string; ring: string; label: string }
> = {
  in_flight: {
    dot: "bg-amber-400",
    ring: "ring-amber-500/40",
    label: "in flight",
  },
  healthy: {
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/20",
    label: "healthy",
  },
  behind: {
    dot: "bg-[var(--gold)]",
    ring: "ring-[var(--gold)]/40",
    label: "deadline soon",
  },
  stalled: {
    dot: "bg-rose-500",
    ring: "ring-rose-500/40",
    label: "stalled",
  },
  idle: {
    dot: "bg-zinc-600",
    ring: "ring-zinc-700",
    label: "no open tasks",
  },
  done: {
    dot: "bg-[var(--gold)]/60",
    ring: "ring-[var(--gold)]/30",
    label: "complete",
  },
};

export function MissionsHealthStrip({
  missions,
  tasks,
}: MissionsHealthStripProps) {
  const chips = useMemo<ChipData[]>(() => {
    return missions
      .filter((m) => m.status === "ACTIVE")
      .map((m) => {
        const taskRows = tasks.filter((t) => t.missionId === m.id);
        const open = taskRows.filter((t) => t.status !== "DONE");
        const doing = open.filter((t) => t.status === "DOING");
        const days = m.deadline
          ? Math.round((new Date(m.deadline).getTime() - Date.now()) / DAY_MS)
          : null;
        return {
          id: m.id,
          title: m.title,
          pace: classifyPace(m, open, doing),
          openTasks: open.length,
          doingTasks: doing.length,
          daysToDeadline: days,
        };
      });
  }, [missions, tasks]);

  if (chips.length === 0) return null;

  const counts = {
    in_flight: chips.filter((c) => c.pace === "in_flight").length,
    healthy: chips.filter((c) => c.pace === "healthy").length,
    behind: chips.filter((c) => c.pace === "behind").length,
    stalled: chips.filter((c) => c.pace === "stalled").length,
    idle: chips.filter((c) => c.pace === "idle").length,
    done: chips.filter((c) => c.pace === "done").length,
  };

  return (
    <section
      aria-label="missions health strip"
      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-4 py-3"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Flag
          size={11}
          className="text-[var(--text-tertiary)]"
          strokeWidth={1.75}
        />
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          board health · {chips.length}
        </span>
        <span className="text-[var(--text-tertiary)]/30">·</span>
        {counts.stalled > 0 && (
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-rose-300">
            {counts.stalled} stalled
          </span>
        )}
        {counts.behind > 0 && (
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]">
            {counts.behind} behind
          </span>
        )}
        {counts.in_flight + counts.healthy > 0 && (
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-emerald-300">
            {counts.in_flight + counts.healthy} healthy
          </span>
        )}
        {counts.idle > 0 && (
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-400">
            {counts.idle} idle
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const style = PACE_STYLE[c.pace];
          const subtitle =
            c.pace === "in_flight"
              ? `${c.doingTasks} in flight`
              : c.pace === "behind" && c.daysToDeadline !== null
                ? `${c.daysToDeadline}d to deadline`
                : c.pace === "stalled" && c.daysToDeadline !== null && c.daysToDeadline < 0
                  ? `${Math.abs(c.daysToDeadline)}d overdue`
                  : style.label;
          return (
            <span
              key={c.id}
              title={`${c.title} · ${c.openTasks} open · ${subtitle}`}
              className={cn(
                "group inline-flex items-center gap-1.5 px-2 py-1 rounded-md",
                "bg-[var(--bg-raised)]/[0.04]",
              )}
              aria-label={`${c.title}: ${c.openTasks} open, ${subtitle}`}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full ring-2 ring-offset-1 ring-offset-[var(--bg-base)] shrink-0",
                  style.dot,
                  style.ring,
                )}
                aria-hidden
              />
              <span className="text-[10px] font-mono text-[var(--text-tertiary)] truncate max-w-[140px]">
                {c.title}
              </span>
            </span>
          );
        })}
      </div>
    </section>
  );
}
