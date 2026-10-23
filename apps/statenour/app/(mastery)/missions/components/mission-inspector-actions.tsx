"use client";

/**
 * MissionInspectorActions · 2026-09-15.
 *
 * Mounted once inside <MissionDispatchProvider>: lends the board's own
 * complete / snooze handlers to the universal task inspector for as long as
 * the page is up (useRegisterInspectorActions releases on unmount). Renders
 * nothing. The handlers are the SAME ones the row calls, so the inspector
 * gets the optimistic board update, the completion prompt and the telemetry
 * for free: there is one mutation path, not two.
 */

import { useMemo } from "react";
import { useRegisterInspectorActions } from "@/hooks/use-inspector";
import type { InspectorPageAction } from "@/lib/state/inspector-store";
import { nextMondayMorning, tomorrowMorning } from "@/lib/missions/snooze-presets";
import { useMissionDispatch } from "../context/mission-dispatch-context";

export function MissionInspectorActions() {
  const { handleCompleteTask, handleSnoozeTask } = useMissionDispatch();
  const actions = useMemo<InspectorPageAction[]>(
    () => [
      { id: "complete", label: "complete", tone: "primary", run: async (id) => { await handleCompleteTask(id); } },
      { id: "snooze-tomorrow", label: "snooze · back tomorrow by 5 am", run: async (id) => { await handleSnoozeTask(id, tomorrowMorning()); } },
      { id: "snooze-next-week", label: "snooze · back Monday by 5 am", run: async (id) => { await handleSnoozeTask(id, nextMondayMorning()); } },
    ],
    [handleCompleteTask, handleSnoozeTask],
  );
  useRegisterInspectorActions("task", actions);
  return null;
}
