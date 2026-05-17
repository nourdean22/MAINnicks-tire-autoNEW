/**
 * Slow query tracker · v10.0.18 · Apr 30 (Horizon 5).
 *
 * Maintains an in-memory rolling buffer of the slowest Prisma queries
 * seen since process boot. The /system/slow-queries dashboard reads
 * `getTopSlowQueries()` to surface what's actually hot.
 *
 * Why in-memory + not Prisma:
 *   · This is a debugging surface, not durable state. Queries that
 *     hit during the current Vercel function lifetime are exactly
 *     what's slow now; persisting across cold starts would dilute
 *     the signal.
 *   · A Prisma write on every slow query event is itself a slow
 *     query — the cure becomes the disease.
 *   · Top-N pattern means memory is bounded regardless of traffic.
 *
 * Cold-start caveat: each lambda has its own buffer. Acceptable for
 * a single-operator system. If multi-tenant ever lands, move to
 * shared Redis or aggregate via SystemMetric on a cron.
 *
 * Composes with v10.0.18 logger — slow queries also fire a log line
 * with surface=db/slow-query so they show up in the structured log
 * stream alongside the dashboard.
 */

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("db/slow-query");

export interface SlowQueryEntry {
  /** Normalized SQL shape — parameter values stripped. */
  shape: string;
  /** Slowest duration observed for this shape in the current process. */
  maxMs: number;
  /** Last time we saw this shape go slow (epoch ms). */
  lastSeenAt: number;
  /** How many times this shape has fired slow since boot. */
  hitCount: number;
}

const TOP_N = 50;
const SHAPE_TRUNCATE = 200;
// Anything shorter than this is treated as a normal-network-latency
// query, not a real slow query worth tracking. Tuned for Neon free tier.
const MIN_SLOW_MS = 250;

interface InternalEntry extends SlowQueryEntry {
  /** Insertion sequence so ties on maxMs sort stably. */
  seq: number;
}

let _seq = 0;
const _buffer = new Map<string, InternalEntry>();

/**
 * Record a slow query. Idempotent on shape — same shape that fires
 * multiple times only counts once but updates maxMs to the slowest
 * observed value + bumps hitCount.
 *
 * Called from lib/prisma.ts inside the $on('query') listener.
 */
export function recordSlowQuery(shape: string, durationMs: number): void {
  if (durationMs < MIN_SLOW_MS) return;
  const truncated = shape.length > SHAPE_TRUNCATE
    ? `${shape.slice(0, SHAPE_TRUNCATE)}…`
    : shape;
  const existing = _buffer.get(truncated);
  if (existing) {
    if (durationMs > existing.maxMs) existing.maxMs = durationMs;
    existing.lastSeenAt = Date.now();
    existing.hitCount += 1;
  } else {
    _buffer.set(truncated, {
      shape: truncated,
      maxMs: durationMs,
      lastSeenAt: Date.now(),
      hitCount: 1,
      seq: _seq++,
    });
    // Bound memory — if we cross 2× TOP_N entries, evict the
    // fastest-and-coldest ones until we're back at 1.5× TOP_N.
    if (_buffer.size > TOP_N * 2) {
      const sorted = [..._buffer.values()].sort(
        (a, b) => a.maxMs - b.maxMs || a.lastSeenAt - b.lastSeenAt,
      );
      for (let i = 0; i < sorted.length - Math.round(TOP_N * 1.5); i++) {
        _buffer.delete(sorted[i].shape);
      }
    }
  }
  // Always log — structured surface so /system dashboards can stream
  // slow queries even if they ship before the user opens this page.
  log.warn("slow_query", { shape: truncated, durationMs });
}

/**
 * Return the top-N slowest queries (by maxMs descending). N is
 * clamped to [1, 50]. Sorted stably so equal maxMs values surface
 * in insertion order (most recent slow query last on ties).
 */
export function getTopSlowQueries(n = 5): SlowQueryEntry[] {
  const limit = Math.max(1, Math.min(n, TOP_N));
  return [..._buffer.values()]
    .sort((a, b) => b.maxMs - a.maxMs || b.seq - a.seq)
    .slice(0, limit)
    .map((e) => ({
      shape: e.shape,
      maxMs: e.maxMs,
      lastSeenAt: e.lastSeenAt,
      hitCount: e.hitCount,
    }));
}

/**
 * Aggregate stats for the slow-query dashboard. Cheap to compute on
 * request — buffer is bounded.
 */
export function getSlowQueryStats(): {
  trackedShapes: number;
  totalHits: number;
  slowestMs: number | null;
  oldestSeenAt: number | null;
} {
  if (_buffer.size === 0) {
    return {
      trackedShapes: 0,
      totalHits: 0,
      slowestMs: null,
      oldestSeenAt: null,
    };
  }
  let totalHits = 0;
  let slowestMs = 0;
  let oldestSeenAt = Number.MAX_SAFE_INTEGER;
  for (const e of _buffer.values()) {
    totalHits += e.hitCount;
    if (e.maxMs > slowestMs) slowestMs = e.maxMs;
    if (e.lastSeenAt < oldestSeenAt) oldestSeenAt = e.lastSeenAt;
  }
  return {
    trackedShapes: _buffer.size,
    totalHits,
    slowestMs,
    oldestSeenAt,
  };
}

/**
 * Test-only — drop the buffer between test runs.
 */
export function _resetSlowQueryBuffer(): void {
  _buffer.clear();
  _seq = 0;
}

/**
 * v10.0.529.106 · Wave 61 · DURABLE FLUSH to SystemMetric.
 *
 * Pre-Wave-61 the slow-query tracker was in-memory only · every
 * Vercel cold start wiped the signal · regressions in query
 * performance were invisible between restarts. The 6-agent audit
 * flagged this as the #2 data-ops opportunity.
 *
 * This function copies the current top-20 slow-query shapes into
 * `SystemMetric` rows so the trend survives cold starts. Designed
 * to be called from mega-morning (once daily) so each day's
 * snapshot is preserved without bloating the metric stream.
 *
 * Each metric row uses:
 *   metric:  "db.slow_query.max_ms"
 *   tags:    { shape: "<truncated>", hitCount: N }
 *   value:   maxMs
 *
 * SystemMetric is already retention-managed (90 days) so the trend
 * naturally rolls forward.
 */
export async function flushSlowQueriesToSystemMetric(): Promise<{
  flushed: number;
  topMs: number;
}> {
  // Dynamic import keeps the slow-query module Prisma-free for tests
  // that import it without a DB connection · only the durable-flush
  // path needs prisma.
  const { prisma } = await import("@/lib/prisma");
  const top = getTopSlowQueries(20);
  if (top.length === 0) return { flushed: 0, topMs: 0 };

  // Use createMany for a single round-trip · skipDuplicates: false
  // because SystemMetric has no unique constraint on the natural key
  // (intentional · we want a row per flush so the time-series is
  // preserved).
  const rows = top.map((q) => ({
    metric: "db.slow_query.max_ms",
    value: q.maxMs,
    source: "slow-query-tracker",
    tags: {
      shape: q.shape,
      hitCount: q.hitCount,
      lastSeenAt: new Date(q.lastSeenAt).toISOString(),
    } as Record<string, unknown>,
  }));

  await prisma.systemMetric
    .createMany({ data: rows as never })
    .catch((err) => {
      // Logging-only · this is a best-effort durable-flush ·
      // failure here doesn't break anything (the in-memory tracker
      // continues to work for the live dashboard).
      log.warn("slow_query_flush_failed", {
        error: err instanceof Error ? err.message : String(err),
        attempted: rows.length,
      });
    });

  return { flushed: top.length, topMs: top[0]?.maxMs ?? 0 };
}
