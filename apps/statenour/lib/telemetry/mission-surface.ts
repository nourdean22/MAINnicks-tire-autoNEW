"use client";

/**
 * Mission-surface telemetry · Wave AA Phase 4 · 2026-05-28.
 *
 * Lightweight in-browser event emitter that records operator-grade
 * signal about which parts of /missions actually get used. The
 * 2-week retention is enough for Phase 4's prune analysis:
 *
 *   "did the IntelPanel children get expanded ≥ 5% of sessions?"
 *   "did Nick's pick actually surface a task the operator started?"
 *   "what's the median time from page-mount to first task complete?"
 *
 * Events are buffered locally + flushed to /api/system/mission-surface-stats
 * in batches of 20 OR every 30s. Server-side aggregation lives at
 * /api/system/mission-surface-stats/GET (no operator UI yet · Phase 4
 * later · script lives at scripts/analyze-mission-surface.ts).
 *
 * Design constraints ·
 *   · Pure client-side. No SSR · safe to import from server components
 *     (the hook itself imports nothing server-only).
 *   · Fail-silent. Telemetry failures NEVER throw or break the UI.
 *   · No PII. Only enum-ish event names + opaque IDs (mission/task UUIDs).
 *   · Cheap. Buffered + debounced · single network call per batch.
 *   · Respects DNT. Disabled when `navigator.doNotTrack === "1"`.
 *
 * Operator-state · Wave AA · the FOURTH source of operator-state
 * signal after morning brief, multi-advisor board, and operator pulse.
 */

import { useCallback, useEffect, useRef } from "react";

const FLUSH_BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 30_000;
const SURFACE_VERSION = "missions/wave-aa-2026-05-28";

// 2026-05-28 · Wave AB · extended to cover /relationships. The same
// telemetry pipeline + 2-week prune analysis applies to both surfaces ·
// the Phase 4 prune script reads BrainMemory(mission_surface_telemetry)
// rows keyed by `surface_<YYYY-MM-DD>_<surface>` so adding a surface
// here also adds it to the daily aggregation buckets automatically.
type SurfaceName = "missions" | "tasks-legacy" | "relationships";

interface QueuedEvent {
  surface: SurfaceName;
  event: string;
  ts: string;
  /** Free-form metadata · stays opaque · never decoded server-side
   *  beyond aggregation by enum value. */
  meta?: Record<string, unknown>;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let surfaceMounted = false;

function isTelemetryEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Respect Do Not Track.
    if (
      navigator.doNotTrack === "1" ||
      // @ts-expect-error · legacy property on some browsers
      window.doNotTrack === "1"
    ) {
      return false;
    }
  } catch {
    /* ignore · default to enabled */
  }
  return true;
}

async function flush(force: boolean = false): Promise<void> {
  if (queue.length === 0) return;
  if (!force && queue.length < FLUSH_BATCH_SIZE) {
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush(true);
      }, FLUSH_INTERVAL_MS);
    }
    return;
  }
  const batch = queue;
  queue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    await fetch("/api/system/mission-surface-stats", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        version: SURFACE_VERSION,
        events: batch,
      }),
    });
  } catch {
    // Re-enqueue at the head · best effort; if it fails again we drop
    // silently rather than spinning a retry loop that costs more than
    // the data is worth.
    queue = [...batch, ...queue].slice(-FLUSH_BATCH_SIZE * 2);
  }
}

function emit(
  surface: SurfaceName,
  event: string,
  meta?: Record<string, unknown>,
): void {
  if (!isTelemetryEnabled()) return;
  queue.push({
    surface,
    event,
    ts: new Date().toISOString(),
    meta,
  });
  void flush(false);
}

/**
 * React hook · fires `mount` once per page-visit + exposes `event` for
 * the page to record specific actions. Cleanup flushes any pending
 * events on unmount so navigation away doesn't lose the buffer.
 */
export function useMissionSurfaceTelemetry(surface: SurfaceName): {
  event: (name: string, meta?: Record<string, unknown>) => void;
} {
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (!surfaceMounted) {
      surfaceMounted = true;
      emit(surface, "mount", { version: SURFACE_VERSION });
    }
    return () => {
      // Best-effort flush on navigation away. keepalive: true in the
      // flush call lets the request survive page-unload.
      void flush(true);
    };
  }, [surface]);

  const event = useCallback(
    (name: string, meta?: Record<string, unknown>) => {
      emit(surface, name, meta);
    },
    [surface],
  );

  return { event };
}

/**
 * Server-importable shape · the POST endpoint will validate against
 * this contract. Exported so the route handler at
 * `app/api/system/mission-surface-stats/route.ts` can share the type.
 */
export interface MissionSurfaceTelemetryBatch {
  version: string;
  events: QueuedEvent[];
}
