"use client";

/**
 * useSystemPulse — shared 30s poll of /api/system/pulse, de-duped across
 * all consumers so N components = 1 network call.
 *
 * v11.0 (W2). Powers FloatingHome orb badges + any health indicators.
 * Module-level cache so React StrictMode double-invokes don't fan out.
 */

import { useEffect, useState } from "react";
// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice · migrated
// off `authedFetch("/api/system/pulse")` onto `trpc.system.pulse`. The
// CRUX of this slice: `fetchPulse()` below is a MODULE-LEVEL function
// (the de-duped singleton poller · NOT a React hook · runs outside any
// component render path), so it CANNOT use the React-hooks tRPC client
// — it uses the vanilla (non-hook) client, the same imperative path
// `ClientErrorTelemetry` uses. `useSystemPulse` IS a hook, but it only
// subscribes to the module cache; the actual fetch never happens in a
// render. The procedure delegates to the SAME `system-pulse.build
// SystemPulse` service the legacy GET /api/system/pulse route was
// slimmed to call · drift impossible.
import { trpcVanilla } from "@/lib/trpc/vanilla-client";

export interface SystemPulse {
  cronFails24h: number;
  /** v11.1 · fresh-tail cron failure count — 1h window. Drives orb tone so
   *  a single transient failure 20h ago no longer holds the orb red. */
  cronFails1h?: number;
  cronsDrifted: number;
  errors24h: number;
  errorsFatal24h: number;
  /** v11.1 · fresh-tail fatal-error count — 6h window for orb tone. */
  errorsFatal6h?: number;
  aiCalls24h: number;
  aiFailures24h: number;
  aiErrorRate: number;
  /** v11.1 · fresh AI volume + fails (1h). */
  aiCalls1h?: number;
  aiFailures1h?: number;
  /** v11.1 · fresh-tail AI error rate. Returns 0 when denominator < 3
   *  so one fail on a cold hour doesn't read as 100%. */
  aiErrorRate1h?: number;
  actionsPending: number;
  actionsFailed24h: number;
  devicesOffline: number;
  devicesTotal: number;
  /** v11.0 · 7d mean Nick-quality score (0-100) · null when no data yet */
  nickQualityAvg7d?: number | null;
  /** 14-to-7d-ago baseline for computing delta */
  nickQualityAvgPrior7d?: number | null;
  /** 7d minus prior 7d · rising ≥+3, falling ≤-3, flat otherwise */
  nickQualityDelta?: number | null;
  nickQualityDirection?: "rising" | "falling" | "flat" | "unknown";
  nickQualityReplies7d?: number;
  /**
   * True when the Neon quota circuit was OPEN and buildSystemPulse
   * short-circuited — every count above is then a fabricated zero, not a
   * measurement.
   *
   * The server has always sent this (lib/services/system-pulse.ts sets it on
   * both the short-circuit and the normal path, and the tRPC procedure returns
   * SystemPulseView verbatim). It was simply never DECLARED here, and the hook
   * casts the payload with a plain `as`, so no consumer could see it — which is
   * how the home strip came to render a green "calm" from queries that never ran.
   *
   * Optional because the module-level cache can still hold a payload minted
   * before this field was read; treat undefined as false.
   */
  dbQuotaExhausted?: boolean;
  generatedAt: string;
}

type Listener = (p: SystemPulse | null) => void;

let cached: SystemPulse | null = null;
let lastFetchAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<Listener>();
let poller: ReturnType<typeof setInterval> | null = null;

const POLL_MS = 30_000;
const STALE_MS = 25_000;

async function fetchPulse(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // Vanilla (non-hook) tRPC client · this function is module-level,
      // not a render path. `system.pulse` returns the explicit flat
      // `SystemPulseView` — structurally a superset of `SystemPulse`
      // (every field this consumer reads is present).
      cached = (await trpcVanilla.system.pulse.query()) as SystemPulse;
      lastFetchAt = Date.now();
      for (const fn of listeners) fn(cached);
    } catch {
      // Swallow — the caller renders a neutral state on null.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function ensurePoller() {
  if (poller) return;
  poller = setInterval(() => {
    if (listeners.size > 0) void fetchPulse();
  }, POLL_MS);
}

function stopPollerIfIdle() {
  if (listeners.size === 0 && poller) {
    clearInterval(poller);
    poller = null;
  }
}

export function useSystemPulse(): SystemPulse | null {
  const [state, setState] = useState<SystemPulse | null>(cached);

  useEffect(() => {
    listeners.add(setState);
    ensurePoller();
    // Refresh immediately if we have no data OR the cache is stale.
    if (!cached || Date.now() - lastFetchAt > STALE_MS) {
      void fetchPulse();
    }
    return () => {
      listeners.delete(setState);
      stopPollerIfIdle();
    };
  }, []);

  return state;
}
