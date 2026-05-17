"use client";

/**
 * useNowSignals — client-side companion to lib/brain/task-signals.ts.
 *
 * Apr 26 · F6 of the NOW-mode upgrades. The server's gatherTaskSignals
 * is the truth source, but the LoopStream needs row-level fit checks
 * that update with time-of-day + state without round-tripping to the
 * server every minute. So we derive a lightweight `LiveSignals` bag
 * client-side from:
 *   · NourState.currentState     (already polled in the layout)
 *   · The tasks array passed in   (already loaded for rendering)
 *   · `new Date()`                (cheap)
 *
 * Pure function under the hook — no fetch, no setInterval. Updates
 * any time the inputs change.
 *
 * The `classifyFit` helper here mirrors the server-side one in
 * lib/brain/task-signals.ts; keep them in sync. (Reasonable to hoist
 * to a shared isomorphic file later — for now this is the only
 * client consumer.)
 */

import { useMemo } from "react";
import { useNourState } from "@/lib/state/nour-state";
import type { Task } from "@/components/actions/shared";

export type LiveState = "peak" | "normal" | "low" | "drift" | "recovery";

export interface LiveSignals {
  hour: number;
  dayOfWeek: number;
  state: LiveState;
  /** Estimated remaining "focused" minutes today; default 240 if unknown. */
  capacityRemainingMin: number;
  /** Total minutes allocated to active tasks. */
  allocatedMin: number;
  /** True when allocatedMin > capacityRemainingMin. */
  overcommitted: boolean;
}

const EFFORT_MIN: Record<string, number> = {
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H2: 120,
  H2PLUS: 120,
  H4: 240,
  H8: 480,
};

function mapStateFromNour(s: string | null | undefined): LiveState {
  if (!s) return "normal";
  if (s === "peak" || s === "drift" || s === "recovery" || s === "low") return s;
  if (s === "energized" || s === "flow") return "peak";
  return "normal";
}

export function useNowSignals(tasks: Task[]): LiveSignals {
  const nour = useNourState();
  return useMemo(() => {
    const now = new Date();
    const hour = now.getHours();
    const state = mapStateFromNour(nour.currentState);
    // Estimated remaining hours of focus today: rough 8am-11pm window
    // gives 15h. Multiply by a base 4h focused / 15h waking ratio
    // (~0.27) so a fresh morning yields ~4h capacity.
    const remainingHours = Math.max(0, 23 - hour);
    const capacityRemainingMin = Math.round(remainingHours * 15);
    let allocatedMin = 0;
    for (const t of tasks) {
      if (!["INBOX", "READY", "DOING"].includes(t.status)) continue;
      allocatedMin += EFFORT_MIN[t.effort ?? "M30"] ?? 30;
    }
    return {
      hour,
      dayOfWeek: now.getDay(),
      state,
      capacityRemainingMin,
      allocatedMin,
      overcommitted: allocatedMin > capacityRemainingMin,
    };
  }, [nour.currentState, tasks]);
}

export type FitVerdict =
  | "fits-now"
  | "save-morning"
  | "wrong-moment"
  | "neutral";

/**
 * Per-task fit. Compute once per row in the LoopStream's render.
 * Pure — no React, no fetch.
 */
export function classifyFit(
  task: Task,
  signals: LiveSignals,
): FitVerdict {
  const energy = (task as Task & { energyRequired?: string }).energyRequired ?? "MEDIUM";
  const effort = task.effort ?? "M30";
  const min = EFFORT_MIN[effort] ?? 30;

  // Drift state + heavy task = wrong-moment regardless of energy.
  if (
    signals.state === "drift" &&
    (effort === "H2" || effort === "H2PLUS" || effort === "H4" || effort === "H8")
  ) {
    return "wrong-moment";
  }

  // High energy demand + low/recovery state = save-morning
  if (energy === "HIGH" && (signals.state === "low" || signals.state === "recovery")) {
    return "save-morning";
  }

  // Wouldn't fit in remaining capacity (with some slack)
  if (min > Math.max(15, signals.capacityRemainingMin)) {
    return "save-morning";
  }

  // Easy fit — low energy task or peak state
  if (energy === "LOW" || signals.state === "peak") return "fits-now";

  return "neutral";
}
