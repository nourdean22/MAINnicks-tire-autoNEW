/**
 * Lightweight Request Tracer · v10.0.377
 *
 * Per /observability-engineer skill · adds per-request observability
 * to autonicks without the cost or vendor-lockin of full OpenTelemetry.
 *
 * What it captures
 *   · method + path + status + duration_ms per request
 *   · error count per route (rolling window)
 *   · p50 / p95 / p99 latency per route
 *   · top 10 slow paths
 *   · top 10 error-prone paths
 *
 * Where it lives
 *   · In-memory ring buffer · last 1000 requests · zero DB cost
 *   · Resets on Vercel cold start (acceptable · we sample, not audit)
 *   · Read via GET /api/system/observability
 *   · Render on /system/observability page (future · operator dashboard)
 *
 * For full OTel export (Datadog / Honeycomb / Tempo), a thin adapter
 * layer would emit each completed trace to the vendor SDK · deferred
 * until the operator picks a vendor.
 */

const MAX_TRACES = 1000;

export interface RequestTrace {
  /** ISO timestamp of request start. */
  at: string;
  method: string;
  path: string;
  /** Final HTTP status code. */
  status: number;
  /** Total duration in milliseconds. */
  durationMs: number;
  /** Error class string if the response was 4xx/5xx · empty otherwise. */
  errorClass?: string;
}

class RingTracer {
  private buf: RequestTrace[] = [];
  private head = 0;

  push(trace: RequestTrace): void {
    if (this.buf.length < MAX_TRACES) {
      this.buf.push(trace);
    } else {
      this.buf[this.head] = trace;
      this.head = (this.head + 1) % MAX_TRACES;
    }
  }

  all(): RequestTrace[] {
    if (this.buf.length < MAX_TRACES) return [...this.buf];
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  size(): number {
    return this.buf.length;
  }

  clear(): void {
    this.buf = [];
    this.head = 0;
  }
}

// Module-scoped singleton · survives across requests within the same
// Vercel function instance.
const tracer = new RingTracer();

export function recordTrace(trace: RequestTrace): void {
  tracer.push(trace);
}

export function getAllTraces(): RequestTrace[] {
  return tracer.all();
}

/**
 * Simplify a path for grouping · /api/ai/chat/abc-123 → /api/ai/chat/[id]
 */
export function normalizePath(path: string): string {
  return path
    .split("?")[0]
    .replace(/\/[a-f0-9]{20,}/g, "/[id]") // long IDs (cuid · uuid)
    .replace(/\/\d+/g, "/[n]");
}

interface RouteAggregate {
  path: string;
  count: number;
  errorCount: number;
  durations: number[];
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export interface ObservabilityReport {
  /** Total traces in current ring · ≤1000 */
  windowSize: number;
  /** Calls per minute (estimated from window age) */
  rpm: number | null;
  /** Overall error rate · 0-1 */
  errorRate: number;
  /** Per-route aggregates · sorted by count desc */
  routes: RouteAggregate[];
  /** Top 10 slowest routes (by p95 latency) */
  slowest: RouteAggregate[];
  /** Top 10 most error-prone routes (by error rate · min 5 calls) */
  mostErrorProne: RouteAggregate[];
  /** Most recent error traces · last 20 */
  recentErrors: RequestTrace[];
  generatedAt: string;
}

export function buildReport(): ObservabilityReport {
  const traces = tracer.all();
  const generatedAt = new Date().toISOString();

  if (traces.length === 0) {
    return {
      windowSize: 0,
      rpm: null,
      errorRate: 0,
      routes: [],
      slowest: [],
      mostErrorProne: [],
      recentErrors: [],
      generatedAt,
    };
  }

  // Group by normalized path
  const byPath = new Map<string, RouteAggregate>();
  let totalErrors = 0;
  for (const t of traces) {
    const path = normalizePath(t.path);
    let agg = byPath.get(path);
    if (!agg) {
      agg = {
        path,
        count: 0,
        errorCount: 0,
        durations: [],
        p50: 0,
        p95: 0,
        p99: 0,
        errorRate: 0,
      };
      byPath.set(path, agg);
    }
    agg.count++;
    agg.durations.push(t.durationMs);
    if (t.status >= 400) {
      agg.errorCount++;
      totalErrors++;
    }
  }

  // Compute percentiles
  const routes: RouteAggregate[] = Array.from(byPath.values()).map((agg) => {
    const sorted = [...agg.durations].sort((a, b) => a - b);
    return {
      ...agg,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      errorRate: agg.count > 0 ? agg.errorCount / agg.count : 0,
      durations: [], // strip · we only needed it for percentiles
    };
  });

  routes.sort((a, b) => b.count - a.count);

  const slowest = [...routes]
    .filter((r) => r.count >= 3) // min sample
    .sort((a, b) => b.p95 - a.p95)
    .slice(0, 10);

  const mostErrorProne = [...routes]
    .filter((r) => r.count >= 5 && r.errorCount > 0)
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10);

  // Most recent errors
  const recentErrors = traces
    .filter((t) => t.status >= 400)
    .slice(-20)
    .reverse();

  // RPM estimate · oldest trace's age vs window size
  let rpm: number | null = null;
  if (traces.length > 1) {
    const oldest = new Date(traces[0].at).getTime();
    const newest = new Date(traces[traces.length - 1].at).getTime();
    const ageMin = Math.max(1 / 60, (newest - oldest) / 60_000);
    rpm = Math.round((traces.length / ageMin) * 10) / 10;
  }

  return {
    windowSize: traces.length,
    rpm,
    errorRate: traces.length > 0 ? totalErrors / traces.length : 0,
    routes,
    slowest,
    mostErrorProne,
    recentErrors,
    generatedAt,
  };
}

/** For tests + ops scripts · clear the ring. */
export function _clearForTesting(): void {
  tracer.clear();
}
