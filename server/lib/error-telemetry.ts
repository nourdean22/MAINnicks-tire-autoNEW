/**
 * Error Telemetry — Track error frequency, detect storms, and report.
 *
 * Features:
 * - Ring buffer of last 500 errors with full context
 * - Error frequency tracking by type and route
 * - Storm detection: >10 errors/min of same type = critical alert
 * - Admin-friendly report for /api/admin/error-report
 *
 * Usage:
 *   import { errorTelemetry } from "../lib/error-telemetry";
 *   errorTelemetry.record(error, { route: "/api/trpc/booking.create", requestId: "abc" });
 *   const report = errorTelemetry.getReport();
 */

import { createLogger } from "./logger";
import type { AppError, ErrorCode } from "./errors";
import { isAppError } from "./errors";

const log = createLogger("error-telemetry");

// ─── Types ──────────────────────────────────────────

interface ErrorEntry {
  timestamp: number;
  code: ErrorCode | "UNKNOWN";
  message: string;
  route?: string;
  requestId?: string;
  statusCode: number;
  isOperational: boolean;
  context: Record<string, unknown>;
}

interface StormAlert {
  code: ErrorCode | "UNKNOWN";
  count: number;
  windowMs: number;
  firstSeen: number;
  lastSeen: number;
  active: boolean;
}

interface ErrorReport {
  summary: {
    totalTracked: number;
    bufferSize: number;
    oldestEntry: string | null;
    newestEntry: string | null;
  };
  last5min: {
    total: number;
    byCode: Record<string, number>;
    byRoute: Record<string, number>;
  };
  last1hr: {
    total: number;
    byCode: Record<string, number>;
    topRoutes: Array<{ route: string; count: number }>;
  };
  storms: StormAlert[];
  recentErrors: Array<{
    timestamp: string;
    code: string;
    message: string;
    route?: string;
    requestId?: string;
  }>;
}

// ─── Configuration ──────────────────────────────────

const BUFFER_SIZE = 500;
const STORM_THRESHOLD = 10;      // errors per window
const STORM_WINDOW_MS = 60_000;  // 1 minute
const STORM_COOLDOWN_MS = 5 * 60_000; // 5 min before re-alerting same code

// ─── Ring Buffer ────────────────────────────────────

class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  toArray(): T[] {
    const result: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}

// ─── Telemetry Engine ───────────────────────────────

class ErrorTelemetry {
  private ring = new RingBuffer<ErrorEntry>(BUFFER_SIZE);
  private stormTrackers = new Map<string, { timestamps: number[]; lastAlertAt: number }>();

  /**
   * Record an error into telemetry. Call this from error middleware.
   */
  record(
    err: unknown,
    meta?: { route?: string; requestId?: string }
  ): void {
    const entry = this.toEntry(err, meta);
    this.ring.push(entry);
    this.checkStorm(entry);
  }

  /**
   * Get a full error report for the admin dashboard.
   */
  getReport(): ErrorReport {
    const all = this.ring.toArray();
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60_000;
    const oneHourAgo = now - 60 * 60_000;

    const last5min = all.filter(e => e.timestamp >= fiveMinAgo);
    const last1hr = all.filter(e => e.timestamp >= oneHourAgo);

    // Count by code (5min)
    const byCode5: Record<string, number> = {};
    const byRoute5: Record<string, number> = {};
    for (const e of last5min) {
      byCode5[e.code] = (byCode5[e.code] || 0) + 1;
      if (e.route) byRoute5[e.route] = (byRoute5[e.route] || 0) + 1;
    }

    // Count by code (1hr)
    const byCode1hr: Record<string, number> = {};
    const routeCount1hr: Record<string, number> = {};
    for (const e of last1hr) {
      byCode1hr[e.code] = (byCode1hr[e.code] || 0) + 1;
      if (e.route) routeCount1hr[e.route] = (routeCount1hr[e.route] || 0) + 1;
    }

    const topRoutes = Object.entries(routeCount1hr)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([route, count]) => ({ route, count }));

    // Active storms
    const storms: StormAlert[] = [];
    for (const [code, tracker] of this.stormTrackers) {
      const recent = tracker.timestamps.filter(t => t >= now - STORM_WINDOW_MS);
      if (recent.length >= STORM_THRESHOLD) {
        storms.push({
          code: code as ErrorCode,
          count: recent.length,
          windowMs: STORM_WINDOW_MS,
          firstSeen: recent[0]!,
          lastSeen: recent[recent.length - 1]!,
          active: true,
        });
      }
    }

    // Last 20 errors for quick review
    const recent = all.slice(-20).reverse();

    return {
      summary: {
        totalTracked: all.length,
        bufferSize: BUFFER_SIZE,
        oldestEntry: all.length > 0 ? new Date(all[0]!.timestamp).toISOString() : null,
        newestEntry: all.length > 0 ? new Date(all[all.length - 1]!.timestamp).toISOString() : null,
      },
      last5min: {
        total: last5min.length,
        byCode: byCode5,
        byRoute: byRoute5,
      },
      last1hr: {
        total: last1hr.length,
        byCode: byCode1hr,
        topRoutes,
      },
      storms,
      recentErrors: recent.map(e => ({
        timestamp: new Date(e.timestamp).toISOString(),
        code: e.code,
        message: e.message.slice(0, 200),
        route: e.route,
        requestId: e.requestId,
      })),
    };
  }

  /**
   * Check if there's currently an active error storm for a given code.
   */
  hasActiveStorm(code?: ErrorCode): boolean {
    const now = Date.now();
    if (code) {
      const tracker = this.stormTrackers.get(code);
      if (!tracker) return false;
      const recent = tracker.timestamps.filter(t => t >= now - STORM_WINDOW_MS);
      return recent.length >= STORM_THRESHOLD;
    }
    // Any storm active
    for (const [, tracker] of this.stormTrackers) {
      const recent = tracker.timestamps.filter(t => t >= now - STORM_WINDOW_MS);
      if (recent.length >= STORM_THRESHOLD) return true;
    }
    return false;
  }

  /**
   * Reset telemetry (for testing or manual clear).
   */
  reset(): void {
    this.ring.clear();
    this.stormTrackers.clear();
  }

  // ─── Internal ───────────────────────────────────

  private toEntry(err: unknown, meta?: { route?: string; requestId?: string }): ErrorEntry {
    if (isAppError(err)) {
      return {
        timestamp: Date.now(),
        code: (err as AppError).code,
        message: err.message,
        route: meta?.route,
        requestId: meta?.requestId,
        statusCode: (err as AppError).statusCode,
        isOperational: (err as AppError).isOperational,
        context: (err as AppError).context,
      };
    }

    return {
      timestamp: Date.now(),
      code: "UNKNOWN",
      message: err instanceof Error ? err.message : String(err),
      route: meta?.route,
      requestId: meta?.requestId,
      statusCode: 500,
      isOperational: false,
      context: { originalType: err?.constructor?.name },
    };
  }

  private checkStorm(entry: ErrorEntry): void {
    const code = entry.code;
    const now = Date.now();

    let tracker = this.stormTrackers.get(code);
    if (!tracker) {
      tracker = { timestamps: [], lastAlertAt: 0 };
      this.stormTrackers.set(code, tracker);
    }

    tracker.timestamps.push(now);

    // Prune old timestamps (keep last 2 windows for hysteresis)
    tracker.timestamps = tracker.timestamps.filter(t => t >= now - STORM_WINDOW_MS * 2);

    // Count in current window
    const recentCount = tracker.timestamps.filter(t => t >= now - STORM_WINDOW_MS).length;

    if (recentCount >= STORM_THRESHOLD && now - tracker.lastAlertAt > STORM_COOLDOWN_MS) {
      tracker.lastAlertAt = now;
      log.fatal(`ERROR STORM DETECTED: ${code} — ${recentCount} errors in ${STORM_WINDOW_MS / 1000}s`, {
        code,
        count: recentCount,
        route: entry.route,
        recentMessage: entry.message.slice(0, 200),
      });
    }
  }
}

// ─── Singleton ──────────────────────────────────────
export const errorTelemetry = new ErrorTelemetry();

// Re-export types for consumers
export type { ErrorReport, ErrorEntry, StormAlert };
