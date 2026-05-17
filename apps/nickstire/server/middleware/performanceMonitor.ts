/**
 * Performance Monitor — Tracks response times per endpoint
 * Rolling averages in memory, warns on slow requests (>2s).
 */

import type { Request, Response, NextFunction } from "express";
import { createLogger } from "../lib/logger";

const log = createLogger("perf");

interface EndpointMetric {
  times: number[];
  errors: number;
}

const metrics = new Map<string, EndpointMetric>();
const MAX_METRIC_KEYS = 200;
const MAX_TIMES_PER_KEY = 100;

// Cleanup metrics every 30 minutes — cap map size and trim old data
setInterval(() => {
  if (metrics.size > MAX_METRIC_KEYS) {
    // Keep only the top 100 most-hit endpoints
    const sorted = Array.from(metrics.entries())
      .sort((a, b) => b[1].times.length - a[1].times.length)
      .slice(0, 100);
    metrics.clear();
    for (const [k, v] of sorted) metrics.set(k, v);
  }
  // Trim each endpoint's history
  for (const [, m] of metrics) {
    if (m.times.length > MAX_TIMES_PER_KEY) {
      m.times = m.times.slice(-MAX_TIMES_PER_KEY);
    }
  }
}, 30 * 60 * 1000);

export function performanceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    // Normalize path to avoid unique-param pollution (e.g., /api/tire/123 → /api/tire/:id)
    const key = `${req.method} ${req.route?.path || req.path}`;

    const existing = metrics.get(key) || { times: [], errors: 0 };
    existing.times.push(duration);
    if (existing.times.length > MAX_TIMES_PER_KEY) existing.times = existing.times.slice(-MAX_TIMES_PER_KEY);
    if (res.statusCode >= 500) existing.errors++;
    metrics.set(key, existing);

    if (duration > 2000) {
      log.warn("Slow request", { path: key, duration, status: res.statusCode });
    }
  });

  next();
}

/** Get performance stats for all endpoints */
export function getPerformanceMetrics(): Array<{
  path: string;
  count: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  errors: number;
}> {
  return Array.from(metrics.entries()).map(([path, m]) => {
    const sorted = [...m.times].sort((a, b) => a - b);
    return {
      path,
      count: m.times.length,
      avgMs: Math.round(m.times.reduce((a, b) => a + b, 0) / m.times.length),
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] || 0,
      maxMs: sorted[sorted.length - 1] || 0,
      errors: m.errors,
    };
  }).sort((a, b) => b.avgMs - a.avgMs);
}

/** Reset all metrics */
export function resetMetrics(): void {
  metrics.clear();
}
