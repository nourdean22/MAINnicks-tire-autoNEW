"use client";

/**
 * MissionInspectorActions · 2026-09-15.
 *
 * Mounted once inside <MissionDispatchProvider>: lends the board's own
 * complete / snooze handlers to the universal task inspector for as long as
 * the page is up (useRegisterInspectorActions releases on unmount). Renders
 * nothing. The handlers are the SAME ones the row calls, so the inspector
 * gets the optimistic board update, the completion prompt and the telemetry
 * for free — there is one mutation path, not two.
 */

import { useMemo } from "react";
import { useRegisterInspectorActions } from "@/hooks/use-inspector";
import type { InspectorPageAction } from "@/lib/state/inspector-store";
import { nextMonday6am, tomorrow6am } from "@/lib/missions/snooze-presets";
import { useMissionDispatch } from "../context/mission-dispatch-context";

export function MissionInspectorActions() {
  const { handleCompleteTask, handleSnoozeTask } = useMissionDispatch();
  const actions = useMemo<InspectorPageAction[]>(
    () => [
      { id: "complete", label: "complete", tone: "primary", run: (id) => handleCompleteTask(id) },
      { id: "snooze-tomorrow", label: "snooze · tomorrow 6am", run: (id) => handleSnoozeTask(id, tomorrow6am()) },
      { id: "snooze-next-week", label: "snooze · next mon", run: (id) => handleSnoozeTask(id, nextMonday6am()) },
    ],
    [handleCompleteTask, handleSnoozeTask],
  );
  useRegisterInspectorActions("task", actions);
  return null;
}
