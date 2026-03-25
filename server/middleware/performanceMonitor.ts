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

export function performanceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const key = `${req.method} ${req.route?.path || req.path}`;

    const existing = metrics.get(key) || { times: [], errors: 0 };
    existing.times.push(duration);
    if (existing.times.length > 500) existing.times = existing.times.slice(-250);
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
