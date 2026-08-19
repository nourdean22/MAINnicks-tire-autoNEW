"use client";

/**
 * THE TODAY ZONE — the "stay on track" surface.
 *
 * ★ UNMOUNTED (verified 2026-08-19): no route or component imports
 * TodayZone, so TodoDesk and everything below renders NOWHERE in the
 * live app. Wiring a feature "into the desk" ships dead code — the
 * outcome-loop wave did exactly that and had to re-wire into /missions
 * (use-mission-actions.handleCompleteTask, the real completion path).
 * Before building here, mount this surface first — or build on /missions.
 *
 * v4 (Apr 18) — Nour's "simpler on the front, super intelligent
 * underneath" directive shipped:
 *   - TodoDesk       (replaces WorkWidget · absorbs BacklogTop3 inline
 *                     · adds window/energy/commitment/reality-gap
 *                     smart chips + Tomorrow preview strip)
 *   - NextActionWhisperer  (kept — fires post-complete momentum)
 *
 * Killed:
 *   - TodaysCaptures        (content moved to BottomPulseTicker)
 *   - WorkWidget            (replaced by TodoDesk)
 *   - BacklogTop3 card      (merged inline at bottom of TodoDesk)
 *   - PlanIntelCard         (v10.0.301 · elon delete · the v6 tools
 *                            panel duplicated FloatingHome navigation
 *                            + carried low-signal vanity counters
 *                            (INDUSTRY/STORIES/TOP SCORE) + an RSS-
 *                            noise CONSUMER LATEST preview. Best
 *                            part is no part. -180 LOC.)
 */

import { TodoDesk } from "./todo-desk";
import { NextActionWhisperer } from "./next-action-whisperer";

export function TodayZone() {
  return (
    <section className="space-y-3">
      <TodoDesk />
      <NextActionWhisperer />
    </section>
  );
}
