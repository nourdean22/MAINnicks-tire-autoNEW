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
 *   │ ▶ VAPI EVAL CRON          70% ·                 │
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
import type { Project, Task } from "@/components/actions/shared";
import { groupMissionFeed } from "@/components/missions/group-mission-feed";
import { MissionCard } from "./mission-card";

export interface MissionFeedProps {
  missions: Project[];
  tasks: Task[];
  /** Rank of each live open task in the deck's one order (deck.taskOrder); cards sort by it. */
  taskRank: Map<string, number>;
}

import { useMissionDispatch } from "@/app/(mastery)/missions/context/mission-dispatch-context";

// 2026-10-23 (map F14) · the nicksPicks / autonomicHealth props and the anchor
// and unattached sections were removed: page.tsx never passed the props and the
// board's task set excludes anchors and unfiled tasks, so none could render.
export function MissionFeed({ missions, tasks, taskRank }: MissionFeedProps) {
  const actions = useMissionDispatch();
  const { activeMissions, tasksByMission } = useMemo(
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
      // settle ONCE: the old loop fired a full 4-cache invalidation per step,
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
  // says only what nothing else on the page says: the next deadline and
  // the autonomic chip: and renders nothing when it has nothing to add.
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
      {nextDeadline && (
      <div className="flex items-center gap-4 py-1 font-mono text-[11px] text-fg-tertiary">
        <span>
          Next deadline ·{" "}
          <span className="text-fg-secondary">
            {nextDeadline}
          </span>
        </span>
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
              taskRank={taskRank}
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
        Missions group your tasks toward a goal. Tap New mission above, or type
        "new mission: &lt;name&gt;" in the add box, or ask Nick to suggest one.
      </p>
      {/* W2: the capture FAB is gone, so nothing covers this button and it
          needs no left offset (the ml-16 lg:ml-0 that cleared it is deleted). */}
      <div className="mt-5">
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
