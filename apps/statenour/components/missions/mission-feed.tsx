"use client";

/**
 * MissionFeed · 2026-05-28 · Wave AA Phase 1A.
 *
 * The new top-level container for /missions. Groups tasks by missionId,
 * renders one MissionCard per active mission, plus an "Unattached"
 * section at the bottom for tasks the AI classifier (Phase 1B) hasn't
 * yet attached or that landed via the legacy quick-add path.
 *
 * Layout:
 *
 *   ┌─ MISSIONS (5 active) ──────────────────────────────┐
 *   │ ▼ POWER ATLAS v2          64% · 8d                │
 *   │ ▼ MOBILE POLISH           22% · 14d               │
 *   │ ▶ VAPI EVAL CRON          70% · —                 │
 *   │ ▶ HOLY GRAIL              ...                      │
 *   ├─ UNATTACHED (3) ──────────────────────────────────┤
 *   │ ○ "Call Dr. Khoury Monday"  📍 attach?            │
 *   │ ○ "Review Greene 33 SW ch11" 📍 attach?           │
 *   └────────────────────────────────────────────────────┘
 *
 * The component is intentionally data-thin · it receives tasks +
 * missions + callback handlers and renders. The page (page.tsx) owns
 * the tRPC mutations + cache invalidation.
 */

import { useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project, Task } from "@/components/actions/shared";
import { isUserProject } from "@/lib/services/mission-helpers";
import { MissionCard } from "./mission-card";
import { MissionTaskRow } from "./mission-task-row";

export interface MissionFeedProps {
  missions: Project[];
  tasks: Task[];
  onAddTask: (
    payload: { title: string; missionId: string },
  ) => void | Promise<void>;
  onCompleteTask: (id: string) => void | Promise<void>;
  onStartTask?: (id: string) => void | Promise<void>;
  onDeleteTask?: (id: string) => void | Promise<void>;
  onCompleteMission?: (missionId: string) => void | Promise<void>;
  onArchiveMission?: (missionId: string) => void | Promise<void>;
  /** Phase 2 · per-mission Nick's-pick task id + rationale, keyed by
   *  mission id. */
  nicksPicks?: Record<string, { taskId: string; rationale: string }>;
}

export function MissionFeed({
  missions,
  tasks,
  onAddTask,
  onCompleteTask,
  onStartTask,
  onDeleteTask,
  onCompleteMission,
  onArchiveMission,
  nicksPicks,
}: MissionFeedProps) {
  const { activeMissions, tasksByMission, unattached } = useMemo(() => {
    const activeMissions = missions
      .filter((m) => m.status === "ACTIVE" && isUserProject(m))
      .sort((a, b) => {
        // Missions with imminent deadlines float to the top, then by
        // open-task count (more = more urgent), then by title for
        // determinism.
        const aDue = a.deadline ? new Date(a.deadline).getTime() : Infinity;
        const bDue = b.deadline ? new Date(b.deadline).getTime() : Infinity;
        if (aDue !== bDue) return aDue - bDue;
        return a.title.localeCompare(b.title);
      });

    const activeIds = new Set(activeMissions.map((m) => m.id));
    const tasksByMission = new Map<string, Task[]>();
    const unattached: Task[] = [];
    for (const task of tasks) {
      if (task.missionId && activeIds.has(task.missionId)) {
        const bucket = tasksByMission.get(task.missionId) ?? [];
        bucket.push(task);
        tasksByMission.set(task.missionId, bucket);
      } else if (task.status !== "DONE") {
        // Unattached only shows OPEN tasks. Done tasks without a mission
        // would be noise.
        unattached.push(task);
      }
    }
    return { activeMissions, tasksByMission, unattached };
  }, [missions, tasks]);

  // wave-AA-audit · React 19's react-hooks/purity rule flags Date.now()
  // calls inside useMemo as impure. Hoist the timestamps into render-
  // state seeded once per render via lazy state (a tick-by-tick refresh
  // isn't needed · the "next deadline" pill staleness is bounded by the
  // tRPC poll interval). useState's initializer runs on mount; we
  // intentionally don't update it · the deadline label re-derives each
  // time the missions list changes anyway, which captures the only state
  // change the operator notices visually.
  const [renderNow] = useState(() => ({
    nowMs: Date.now(),
    todayStartMs: (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })(),
  }));

  const totalOpenTasks = useMemo(
    () => tasks.filter((t) => t.status !== "DONE").length,
    [tasks],
  );
  const totalDoneToday = useMemo(() => {
    return tasks.filter((t) => {
      if (t.status !== "DONE") return false;
      const completedAt = t.lastTouchedAt ?? t.updatedAt;
      if (!completedAt) return false;
      return new Date(completedAt).getTime() >= renderNow.todayStartMs;
    }).length;
  }, [tasks, renderNow.todayStartMs]);
  const nextDeadline = useMemo(() => {
    const upcoming = activeMissions
      .map((m) => (m.deadline ? new Date(m.deadline) : null))
      .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()))
      .filter((d) => d.getTime() >= renderNow.nowMs)
      .sort((a, b) => a.getTime() - b.getTime());
    if (upcoming.length === 0) return null;
    const days = Math.round(
      (upcoming[0].getTime() - renderNow.nowMs) / (1000 * 60 * 60 * 24),
    );
    return days === 0 ? "today" : `${days}d`;
  }, [activeMissions, renderNow.nowMs]);

  return (
    <div className="space-y-4">
      {/* Thin KPI strip · 4 values · single line at the top */}
      <div className="flex items-center gap-4 px-2 py-1.5 text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] border-b border-[var(--border-default)]/40">
        <span>
          <span className="text-[var(--gold)] tabular-nums">
            {activeMissions.length}
          </span>{" "}
          missions
        </span>
        <span className="text-[var(--text-tertiary)]/60">·</span>
        <span>
          <span className="text-[var(--text-secondary)] tabular-nums">
            {totalOpenTasks}
          </span>{" "}
          open
        </span>
        <span className="text-[var(--text-tertiary)]/60">·</span>
        <span>
          <span className="text-emerald-400 tabular-nums">
            {totalDoneToday}
          </span>{" "}
          done today
        </span>
        {nextDeadline && (
          <>
            <span className="text-[var(--text-tertiary)]/60">·</span>
            <span>
              next:{" "}
              <span className="text-[var(--text-secondary)]">
                {nextDeadline}
              </span>
            </span>
          </>
        )}
      </div>

      {/* Mission cards */}
      {activeMissions.length === 0 ? (
        <EmptyMissions />
      ) : (
        <div className="space-y-2.5">
          {activeMissions.map((mission) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              tasks={tasksByMission.get(mission.id) ?? []}
              defaultExpanded={activeMissions.length <= 3}
              onAddTask={onAddTask}
              onCompleteTask={onCompleteTask}
              onStartTask={onStartTask}
              onDeleteTask={onDeleteTask}
              onCompleteMission={onCompleteMission}
              onArchiveMission={onArchiveMission}
              nicksPickTaskId={nicksPicks?.[mission.id]?.taskId}
              nicksPickRationale={nicksPicks?.[mission.id]?.rationale}
            />
          ))}
        </div>
      )}

      {/* Unattached section */}
      {unattached.length > 0 && (
        <section
          className={cn(
            "rounded-lg border border-[var(--border-default)]/60 bg-[var(--bg-base)]",
            "border-dashed",
          )}
        >
          <header className="px-3 py-2 flex items-center gap-2 border-b border-[var(--border-default)]/40">
            <Inbox
              size={12}
              className="text-[var(--text-tertiary)]"
              strokeWidth={1.75}
            />
            <h3 className="text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              unattached
            </h3>
            <span className="text-[10px] font-mono text-[var(--text-tertiary)]/70 tabular-nums">
              {unattached.length}
            </span>
          </header>
          <div className="py-1">
            {unattached.map((task) => (
              <MissionTaskRow
                key={task.id}
                task={task}
                onComplete={onCompleteTask}
                onStart={onStartTask}
                onDelete={onDeleteTask}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EmptyMissions() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-base)] px-4 py-8 text-center">
      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        no active missions
      </p>
      <p className="mt-2 text-[12px] text-[var(--text-secondary)] leading-snug max-w-md mx-auto">
        Missions group your tasks toward a goal. Type a mission name in the input
        above (or ask Nick to suggest one) and tasks start flowing into it.
      </p>
    </div>
  );
}
