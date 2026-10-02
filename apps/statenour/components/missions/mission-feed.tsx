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
import { Inbox, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project, Task } from "@/components/actions/shared";
import { groupMissionFeed } from "@/components/missions/group-mission-feed";
import { MissionCard } from "./mission-card";
import { MissionTaskRow } from "./mission-task-row";

export interface MissionFeedProps {
  missions: Project[];
  tasks: Task[];
  /** Phase 2 · per-mission Nick's-pick task id + rationale, keyed by
   *  mission id. */
  nicksPicks?: Record<string, { taskId: string; rationale: string }>;
  /** truth-substrate audit P0 (#4-6): a MetricResult, so an UNMEASURED autonomic
   *  read renders as UNKNOWN instead of a fake "offline/idle". */
  autonomicHealth?: MetricResult<{
    lastRunAt: string | null;
    status: string | null;
    error: string | null;
  }>;
}

import { useMissionDispatch } from "@/app/(mastery)/missions/context/mission-dispatch-context";
import type { MetricResult } from "@/lib/services/metric-result";

export function MissionFeed({
  missions,
  tasks,
  nicksPicks,
  autonomicHealth,
}: MissionFeedProps) {
  const actions = useMissionDispatch();
  const { activeMissions, tasksByMission, unattached, domainGroups } = useMemo(
    // truth-substrate audit P1 (#19): pure grouping extracted to
    // group-mission-feed.ts so it is unit-testable + can't drift.
    () => groupMissionFeed(missions, tasks),
    [missions, tasks],
  );

  // Drag and drop states for Missions
  const [draggedMissionIdx, setDraggedMissionIdx] = useState<number | null>(null);
  const [draggedOverMissionIdx, setDraggedOverMissionIdx] = useState<number | null>(null);

  const handleMissionDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedMissionIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleMissionDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedMissionIdx === null || draggedMissionIdx === idx) return;
    setDraggedOverMissionIdx(idx);
  };

  const handleMissionDragLeave = () => {
    setDraggedOverMissionIdx(null);
  };

  const handleMissionDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex = draggedMissionIdx;
    setDraggedMissionIdx(null);
    setDraggedOverMissionIdx(null);

    if (sourceIndex === null || sourceIndex === targetIndex) return;

    const mission = activeMissions[sourceIndex];
    if (!mission) return;

    try {
      // Execution Deck P0 (2026-09-01): steps skip their per-step refetch and
      // settle ONCE — the old loop fired a full 4-cache invalidation per step,
      // making an 8-position drag 32 round trips.
      if (targetIndex < sourceIndex) {
        for (let i = sourceIndex; i > targetIndex; i--) {
          await actions.handleMoveMission(mission.id, "up", { skipRefetch: true });
        }
      } else {
        for (let i = sourceIndex; i < targetIndex; i++) {
          await actions.handleMoveMission(mission.id, "down", { skipRefetch: true });
        }
      }
    } catch (err) {
      console.error("Failed to reorder mission via drag & drop", err);
    } finally {
      await actions.settleReorder();
    }
  };

  const handleTaskDropOnMission = async (taskId: string, targetMissionId: string) => {
    try {
      // Find the task to see if it's already in this mission
      const task = tasks.find(t => t.id === taskId);
      if (!task || task.missionId === targetMissionId) return;
      
      // Update task missionId. Note: `useMissionActions` handles invalidation on success.
      await actions.handleUpdateTaskFields(taskId, { missionId: targetMissionId });
    } catch (err) {
      console.error("Failed to move task to mission", err);
    }
  };

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

  // 2026-09-16 · Visible Transformation: the strip used to repeat the
  // page heading's "N active · N open" and the rail's "done today"; it now
  // says only what nothing else on the page says — the next deadline and
  // the autonomic chip — and renders nothing when it has nothing to add.
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
    <div className="space-y-8">
      {(nextDeadline || autonomicHealth) && (
      <div className="flex items-center gap-4 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
        {nextDeadline && (
          <span>
            next deadline ·{" "}
            <span className="text-fg-secondary">
              {nextDeadline}
            </span>
          </span>
        )}
        {autonomicHealth && (() => {
          // truth-substrate audit #4-6: unwrap the MetricResult with proper
          // narrowing. When the read was `unavailable` (or degraded with no
          // value), show a distinct UNKNOWN chip — never a fabricated OFFLINE.
          const av = autonomicHealth.status !== "unavailable" ? autonomicHealth.value : undefined;
          if (!av) {
            return (
              <div
                className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] tracking-[0.1em] font-mono bg-amber-500/10 border-amber-500/30 text-amber-400"
                title="Autonomic health could not be measured (health probe read failed). This is UNKNOWN, not idle."
              >
                <span className="w-1 h-1 rounded-full bg-amber-400" />
                <span>AUTONOMIC: UNKNOWN</span>
              </div>
            );
          }
          return (
            <div
              className={cn(
                "ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] tracking-[0.1em] font-mono",
                av.status === "success"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : av.status === "failed"
                    ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                    : "bg-surface-interactive border-edge-default text-fg-tertiary"
              )}
              title={
                av.lastRunAt
                  ? `Last Maintenance Run: ${formatTimeAgo(av.lastRunAt)} (${new Date(av.lastRunAt).toLocaleTimeString()})${av.error ? `\nError: ${av.error}` : ''}`
                  : "Autonomic Orchestrator: Idle/No Run Found"
              }
            >
              <span
                className={cn(
                  "w-1 h-1 rounded-full",
                  av.status === "success"
                    ? "bg-emerald-400"
                    : av.status === "failed"
                      ? "bg-rose-400"
                      : "bg-fg-tertiary"
                )}
              />
              <span>
                AUTONOMIC: {av.status === "success" ? "ONLINE" : av.status === "failed" ? "DEGRADED" : "OFFLINE"}
              </span>
            </div>
          );
        })()}
      </div>
      )}

      {/* Mission cards · a ruled list, not a stack of boxes */}
      {activeMissions.length === 0 ? (
        <EmptyMissions />
      ) : (
        <div className="divide-y divide-edge border-y border-edge">
          {activeMissions.map((mission, missionIdx) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              tasks={tasksByMission.get(mission.id) ?? []}
              defaultExpanded={activeMissions.length <= 3}
              nicksPickTaskId={nicksPicks?.[mission.id]?.taskId}
              nicksPickRationale={nicksPicks?.[mission.id]?.rationale}
              missionIdx={missionIdx}
              totalMissions={activeMissions.length}
              isDragged={draggedMissionIdx === missionIdx}
              isDraggedOver={draggedOverMissionIdx === missionIdx}
              onDragStart={(e) => handleMissionDragStart(e, missionIdx)}
              onDragOver={(e) => handleMissionDragOver(e, missionIdx)}
              onDragLeave={handleMissionDragLeave}
              onDrop={(e) => handleMissionDrop(e, missionIdx)}
              onTaskDropOnMission={handleTaskDropOnMission}
            />
          ))}
        </div>
      )}

      {/* Domains section — GENERAL anchor buckets (audit #19). These are
          CLASSIFIED tasks routed to a per-domain anchor, shown distinctly from
          the "unattached" (truly unclassified) pile below. */}
      {domainGroups.map((group) => (
        <section key={group.anchor.id}>
          <header className="flex items-center gap-2 border-b border-edge pb-3">
            <Layers
              size={14}
              className="text-fg-tertiary"
              strokeWidth={1.75}
            />
            <h3 className="vt-eyebrow text-fg-secondary">
              {group.anchor.title}
            </h3>
            <span className="font-mono text-[12px] tabular-nums text-fg-tertiary">
              {group.tasks.length}
            </span>
          </header>
          <div className="divide-y divide-edge">
            {group.tasks.map((task) => (
              <MissionTaskRow key={task.id} task={task} />
            ))}
          </div>
        </section>
      ))}

      {/* Unattached section */}
      {unattached.length > 0 && (
        <section>
          <header className="flex items-center gap-2 border-b border-dashed border-edge pb-3">
            <Inbox
              size={14}
              className="text-fg-tertiary"
              strokeWidth={1.75}
            />
            <h3 className="vt-eyebrow text-fg-secondary">
              unattached
            </h3>
            <span className="font-mono text-[12px] tabular-nums text-fg-tertiary">
              {unattached.length}
            </span>
          </header>
          <div className="divide-y divide-edge">
            {unattached.map((task) => (
              <MissionTaskRow
                key={task.id}
                task={task}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EmptyMissions() {
  const handleAskNick = () => {
    const customEvent = new CustomEvent("statenour:open-nick", {
      detail: {
        pendingPrompt: "Analyze my active goals and suggest 3 high-impact missions to focus on today.",
        submitOnMount: true,
      },
    });
    window.dispatchEvent(customEvent);
  };

  return (
    <div className="border-l-2 border-edge py-2 pl-5 sm:pl-6">
      <p className="vt-eyebrow text-fg-tertiary">
        no active missions
      </p>
      <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-fg-secondary">
        Missions group your tasks toward a goal. Type a mission name in the input
        above (or ask Nick to suggest one) and tasks start flowing into it.
      </p>
      {/* Clear the fixed capture FAB, which lives in the bottom-left corner
          and covered this button by 22x28px (floating-collision spec).
          THE BREAKPOINT IS NOT A GUESS: the FAB is `lg:hidden` (omni-capture-
          modal.tsx), so the lane it occupies exists at every width below
          1024px. The first cut of this fix reset at `sm` (640px) and the spec
          went red again at 768px, where the FAB is still on screen. If the
          FAB's own breakpoint ever moves, this one moves with it. */}
      <div className="mt-5 ml-16 lg:ml-0">
        <button
          type="button"
          onClick={handleAskNick}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
        >
          Ask Nick for recommendations
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return "never";
  const ms = Date.now() - new Date(isoString).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}
