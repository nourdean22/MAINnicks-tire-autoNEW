"use client";

/**
 * v10.0.526 · useObservability — shared fetch surface for the four Ultron
 * observability tiles (cost-slo · voice-latency · eval-pass-rate · os-drift).
 *
 * Why this hook exists (kaizen + frontend-design):
 *   · The four tiles share the same lifecycle (mount on HQ · poll every 60s ·
 *     handle 404/500/empty consistently) — without a shared hook every tile
 *     would duplicate the auth/poll/error state machine, drift over time, and
 *     hammer the network with four independent timer cascades.
 *   · The underlying `useUltronFetch` cache already coalesces identical URLs
 *     so each tile keeps its own typed slice but the 4 round-trips are
 *     deduped + cached at the module level. Cost = 4 parallel GETs, not 16.
 *
 * Wave 2 endpoints (some not live yet · all four tiles tolerate 404/empty):
 *   · GET /api/system/cost-slo          → CostSloShape
 *   · GET /api/system/voice-latency     → VoiceLatencyShape
 *   · GET /api/system/eval-results      → EvalResultsShape  (live since v524)
 *   · GET /api/system/os-snapshot       → OsSnapshotShape
 *
 * Each slice returns one of: { kind: "loading" } | { kind: "ready", data }
 * | { kind: "empty" } | { kind: "error", message } — so the tile component
 * only has to switch on `state.kind`, not re-implement the lifecycle.
 *
 * The fetch is owner-only behind apiHandler({ auth: "owner" }) on the API
 * side; that's already enforced — this hook just bubbles HTTP status into
 * the four sub-states so the tile can render an empty/error treatment
 * instead of a noisy red card.
 */

import { useUltronFetch } from "@/lib/ultron/client-cache";

// ── Shape contracts (loose — endpoints may evolve, tiles defend) ─────────

export interface CostSloShape {
  /** Today's accumulated spend in USD (across all providers). */
  burnUsdToday?: number;
  /** Daily budget cap in USD. 0 means "no cap configured" → tile shows hint. */
  dailyBudgetUsd?: number;
  /** Trailing 7d daily-burn series (oldest first) for the sparkline. */
  burn7d?: number[];
  /** Projected end-of-day burn given current rate. */
  forecastUsdEod?: number;
  /** Top costliest conversations in the current window (for drilldown). */
  topConversations?: Array<{
    id: string;
    label: string;
    usd: number;
  }>;
}

export interface VoiceLatencyShape {
  /** P50 end-to-end latency in ms across the latest window (default last 24h). */
  p50Ms?: number;
  /** P95 — surfaced as tooltip context, not the headline. */
  p95Ms?: number;
  /** Latest N call latencies (oldest first) for sparkline. */
  recentMs?: number[];
  /** Consecutive calls breaching the 800ms hard ceiling. Resets on a clean call. */
  breachStreak?: number;
  /** Hard SLO red threshold in ms. Default 800 if the server omits. */
  redThresholdMs?: number;
  /** Soft SLO amber threshold in ms. Default 500 if the server omits. */
  amberThresholdMs?: number;
}

export interface EvalResultsShape {
  /** Latest-first list of regression-runner result rows. */
  results?: Array<{
    id: string;
    ranAt: string;
    passed: number;
    failed: number;
    totalRan: number;
    passRate: number;
    worstCategories?: Array<{ category: string; failed: number; total: number }>;
  }>;
  count?: number;
}

export interface OsSnapshotShape {
  /** Now-vs-7d-ago count snapshot. Each field optional — server fills what
   *  it can. Tile renders a delta vs prior; when prior is missing it shows
   *  only the now-count. */
  now?: { routes?: number; crons?: number; tools?: number; monsters?: number };
  prior?: { routes?: number; crons?: number; tools?: number; monsters?: number };
  /** ISO timestamp of when the snapshot rolled-up — surfaced for staleness. */
  generatedAt?: string;
  /** Threshold in LOC above which a file is "monster" (default 800 server-side). */
  monsterLocThreshold?: number;
}

// ── Per-slice state machine ──────────────────────────────────────────────

export type TileState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "empty" }
  | { kind: "error"; message: string };

interface RawFetch<T> {
  data: T | null;
  loading: boolean;
  refetch: () => void;
}

/**
 * Classify a raw useUltronFetch result into the four-state model the
 * tiles consume. Empty = the endpoint returned 200 but with no signal
 * to display (e.g. no eval has run yet). Error = network/HTTP failure.
 *
 * We can't distinguish 404 from 500 cleanly because useUltronFetch
 * swallows the status into a boolean; the existing pattern (cars-today
 * card) treats those identically as "endpoint not live yet" → empty.
 * That mirrors the rest of the app — the tile is graceful, not noisy.
 */
function classify<T>(
  raw: RawFetch<T>,
  isEmpty: (d: T) => boolean,
): TileState<T> {
  if (raw.loading && raw.data === null) return { kind: "loading" };
  if (raw.data === null) {
    // Loading finished but data is still null → fetch failed or 404.
    // No status code available here; treat as empty so the tile shows
    // a quiet "endpoint not live yet" hint instead of a red panel.
    return { kind: "empty" };
  }
  if (isEmpty(raw.data)) return { kind: "empty" };
  return { kind: "ready", data: raw.data };
}

// ── Public hook ──────────────────────────────────────────────────────────

interface UseObservabilityResult {
  cost: TileState<CostSloShape>;
  voice: TileState<VoiceLatencyShape>;
  evals: TileState<EvalResultsShape>;
  osSnapshot: TileState<OsSnapshotShape>;
  reload: () => void;
}

/**
 * Fetch the four observability slices in parallel via the shared cache.
 * Each endpoint polls on its own cadence appropriate to its volatility.
 */
export function useObservability(): UseObservabilityResult {
  // 60s poll for cost (it ticks per-conversation · users want fresh).
  const cost = useUltronFetch<CostSloShape>("/api/system/cost-slo", {
    ttlMs: 30_000,
    pollMs: 60_000,
  });

  // 60s poll for voice (it spikes around active call windows).
  const voice = useUltronFetch<VoiceLatencyShape>("/api/system/voice-latency", {
    ttlMs: 30_000,
    pollMs: 60_000,
  });

  // 5min poll for eval (regression runs are nightly — fast poll is wasteful).
  const evals = useUltronFetch<EvalResultsShape>("/api/system/eval-results?limit=8", {
    ttlMs: 300_000,
    pollMs: 300_000,
  });

  // 5min poll for OS snapshot (structural shape — slow-moving).
  const osSnapshot = useUltronFetch<OsSnapshotShape>("/api/system/os-snapshot", {
    ttlMs: 300_000,
    pollMs: 300_000,
  });

  return {
    cost: classify(cost, (d) =>
      // Empty when neither today's burn nor the sparkline has anything.
      (d.burnUsdToday ?? 0) === 0 && (d.burn7d?.length ?? 0) === 0,
    ),
    voice: classify(voice, (d) =>
      (d.p50Ms ?? 0) === 0 && (d.recentMs?.length ?? 0) === 0,
    ),
    evals: classify(evals, (d) => (d.results?.length ?? 0) === 0),
    osSnapshot: classify(osSnapshot, (d) =>
      !d.now ||
      (((d.now.routes ?? 0) +
        (d.now.crons ?? 0) +
        (d.now.tools ?? 0) +
        (d.now.monsters ?? 0)) === 0),
    ),
    reload: () => {
      cost.refetch();
      voice.refetch();
      evals.refetch();
      osSnapshot.refetch();
    },
  };
}

// ── Pure helpers exported for tile + test reuse ──────────────────────────

/** Format USD with smart precision. `$0.04` for sub-dollar, `$12.40` for $1+,
 *  `$1.2k` for $1000+ — keeps tile glanceable on mobile. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "—";
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(3)}`;
}

/** Map a latency value (ms) to one of three tier bands. Used by tile color
 *  + the icon. Thresholds passed in so the server can tune live. */
export function latencyTier(
  ms: number,
  amberMs: number,
  redMs: number,
): "green" | "amber" | "red" {
  if (!Number.isFinite(ms) || ms <= 0) return "green";
  if (ms >= redMs) return "red";
  if (ms >= amberMs) return "amber";
  return "green";
}

/** Map a pass-rate fraction (0-1) to tier band for color. */
export function passRateTier(rate: number): "green" | "amber" | "red" {
  if (!Number.isFinite(rate)) return "red";
  if (rate >= 0.9) return "green";
  if (rate >= 0.75) return "amber";
  return "red";
}

/** Diff helper — returns +N / -N / 0 with sign string. */
export function signedDelta(now?: number, prior?: number): {
  delta: number;
  text: string;
  direction: "up" | "down" | "flat";
} {
  const a = now ?? 0;
  const b = prior ?? 0;
  const delta = a - b;
  if (delta === 0) return { delta: 0, text: "0", direction: "flat" };
  return {
    delta,
    text: delta > 0 ? `+${delta}` : `${delta}`,
    direction: delta > 0 ? "up" : "down",
  };
}
