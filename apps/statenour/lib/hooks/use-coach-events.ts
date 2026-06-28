"use client";

/**
 * useCoachEvents — shared, surface-keyed poll of /api/coach/events, de-duped
 * across all consumers so N components on the same surface = 1 network call.
 *
 * Before: `CoachEventBanner` (90s) and `NickSidePane` (60s) each ran their own
 * `usePollingFetch` against the SAME `/api/coach/events?surface=X` — two timers
 * fetching identical data on every page that mounts both (/stats, /journal,
 * /missions). This collapses them to ONE module-level poller per
 * (surface, limit), modeled on `lib/hooks/use-system-pulse.ts`.
 *
 * Coach events have no tRPC procedure (REST-only), so the singleton uses
 * `fetch` directly. Errors swallow → consumers render the empty/neutral state.
 * `enabled: false` (e.g. a closed side pane) unsubscribes so no poll runs.
 */

import { useCallback, useEffect, useState } from "react";
import type { CoachEvent, CoachEventSurface } from "@/lib/services/coach-events-types";

const POLL_MS = 60_000; // the faster of the two prior cadences (pane 60s)
const STALE_MS = 55_000;

type Listener = (events: CoachEvent[]) => void;

interface Entry {
  url: string;
  cached: CoachEvent[] | null;
  lastFetchAt: number;
  inflight: Promise<void> | null;
  listeners: Set<Listener>;
  poller: ReturnType<typeof setInterval> | null;
}

// Keyed by `${surface}:${limit}` so distinct surfaces (or limits) each get
// their own shared poller, while same-surface consumers share one.
const entries = new Map<string, Entry>();

function getEntry(surface: CoachEventSurface, limit: number): Entry {
  const key = `${surface}:${limit}`;
  let e = entries.get(key);
  if (!e) {
    e = {
      url: `/api/coach/events?surface=${encodeURIComponent(surface)}&limit=${limit}`,
      cached: null,
      lastFetchAt: 0,
      inflight: null,
      listeners: new Set(),
      poller: null,
    };
    entries.set(key, e);
  }
  return e;
}

async function fetchEntry(e: Entry): Promise<void> {
  if (e.inflight) return e.inflight;
  e.inflight = (async () => {
    try {
      const res = await fetch(e.url, { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { events?: CoachEvent[] };
      e.cached = data.events ?? [];
      e.lastFetchAt = Date.now();
      for (const fn of e.listeners) fn(e.cached);
    } catch {
      // Swallow — the channel is advisory; consumers render the empty state.
    } finally {
      e.inflight = null;
    }
  })();
  return e.inflight;
}

function ensurePoller(e: Entry): void {
  if (e.poller) return;
  e.poller = setInterval(() => {
    // Tab-visibility pause (matches usePollingFetch behavior).
    if (e.listeners.size > 0 && (typeof document === "undefined" || !document.hidden)) {
      void fetchEntry(e);
    }
  }, POLL_MS);
}

function stopPollerIfIdle(e: Entry): void {
  if (e.listeners.size === 0 && e.poller) {
    clearInterval(e.poller);
    e.poller = null;
  }
}

/**
 * Subscribe to the shared coach-event stream for a surface.
 * @returns `events` (empty array until first fetch) + `reload` (force refetch,
 *          e.g. after an optimistic dismiss/ack).
 */
export function useCoachEvents(
  surface: CoachEventSurface | null | undefined,
  opts?: { limit?: number; enabled?: boolean },
): { events: CoachEvent[]; reload: () => void } {
  const limit = opts?.limit ?? 3;
  const enabled = opts?.enabled ?? true;
  const active = !!surface && enabled;

  const currentKey = `${surface}:${limit}:${active}`;
  const [prevKey, setPrevKey] = useState(currentKey);
  const [events, setEvents] = useState<CoachEvent[]>(() =>
    active && surface ? getEntry(surface, limit).cached ?? [] : [],
  );

  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    const e = active && surface ? getEntry(surface, limit) : null;
    const initialEvents = e ? e.cached ?? [] : [];
    setEvents(initialEvents);
  }

  useEffect(() => {
    if (!active || !surface) {
      return;
    }
    const e = getEntry(surface, limit);
    const listener: Listener = (ev) => setEvents(ev);
    e.listeners.add(listener);
    ensurePoller(e);
    if (!e.cached || Date.now() - e.lastFetchAt > STALE_MS) void fetchEntry(e);
    return () => {
      e.listeners.delete(listener);
      stopPollerIfIdle(e);
    };
  }, [surface, limit, active]);

  const reload = useCallback(() => {
    if (active && surface) void fetchEntry(getEntry(surface, limit));
  }, [surface, limit, active]);

  return { events, reload };
}
