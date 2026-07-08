"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { type Project, type Task } from "@/components/actions/shared";
import { MissionFeed } from "@/components/missions/mission-feed";
import { MissionDispatchProvider } from "@/app/(mastery)/missions/context/mission-dispatch-context";
import { useMissionActions } from "@/app/(mastery)/missions/hooks/use-mission-actions";

/**
 * War-Room · Slice 4 · Missions tile content.
 *
 * Full feed + MissionDispatchProvider + draggable task cards.
 * Implements the killer gesture: Drag task card to mission.
 */
export function MissionsTile() {
  const missionsQuery = trpc.task.missions.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  const tasksQuery = trpc.task.list.useQuery(
    {},
    { refetchInterval: 15_000, refetchOnWindowFocus: false },
  );
  // Autonomic health for the feed header
  const healthQuery = trpc.system.healthSummary.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const missions = (missionsQuery.data ?? []) as Project[];
  const tasks = (tasksQuery.data ?? []) as Task[];

  const actions = useMissionActions({ tasks, missions });

  if (missionsQuery.isLoading || tasksQuery.isLoading) {
    return <TileMsg>loading missions…</TileMsg>;
  }
  if (missionsQuery.isError || tasksQuery.isError) {
    return <TileMsg tone="error">missions unavailable</TileMsg>;
  }

  return (
    <MissionDispatchProvider actions={actions}>
      <div className="h-full overflow-y-auto custom-scrollbar">
        <MissionFeed 
          missions={missions} 
          tasks={tasks} 
          autonomicHealth={healthQuery.data?.autonomic}
        />
      </div>
    </MissionDispatchProvider>
  );
}

function TileMsg({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div className="flex h-full items-center justify-center">
      <span
        className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
          tone === "error" ? "text-rose-300/80" : "animate-pulse text-[var(--text-tertiary)]"
        }`}
      >
        {children}
      </span>
    </div>
  );
}
