/**
 * Core Web Vitals Telemetry — real-user metric capture + percentile rollups.
 *
 * Why this instead of Google CrUX:
 *   - Zero external API key or cloud dep
 *   - Instant — no 28-day rolling window delay
 *   - Segmentable by route (which page is slow?)
 *   - Private — data never leaves our server
 *
 * Metrics captured:
 *   LCP  (Largest Contentful Paint) — target ≤ 2500ms
 *   CLS  (Cumulative Layout Shift)  — target ≤ 0.1
 *   INP  (Interaction to Next Paint, replaces FID) — target ≤ 200ms
 *   FCP  (First Contentful Paint)   — target ≤ 1800ms
 *   TTFB (Time to First Byte)       — target ≤ 800ms
 *
 * Flow:
 *   1. Client captures via PerformanceObserver (see client/src/lib/cwv.ts)
 *   2. POSTs to /api/cwv (lightweight — no session cookie needed)
 *   3. This module buffers + computes p50/p75/p95 by metric + by route
 *   4. Admin pulls the report via controlCenter.webVitals query
 */

import { createLogger } from "./logger";

const log = createLogger("cwv-telemetry");

export type CwvMetric = "LCP" | "CLS" | "INP" | "FCP" | "TTFB";

export interface CwvSample {
  metric: CwvMetric;
  value: number;
  /** URL path (no query / hash) */
  route: string;
  /** Navigation type — "navigate" | "reload" | "back_forward" | "prerender" */
  navType: string;
  /** Client ID (random, not logged in) for per-session dedup */
  sessionId: string;
  /** Timestamp from the client (ms since epoch) */
  timestamp: number;
}

// Ring buffer — last 5k samples stays in memory (~500 KB max)
const BUFFER_SIZE = 5000;
const buffer: CwvSample[] = [];
let head = 0;
let count = 0;

/** Record a single sample. Called from /api/cwv handler. */
export function recordCwvSample(sample: Omit<CwvSample, "timestamp"> & { timestamp?: number }): void {
  const complete: CwvSample = {
    ...sample,
    timestamp: sample.timestamp ?? Date.now(),
  };

  // Cheap validation — drop garbage
  if (typeof complete.value !== "number" || complete.value < 0 || complete.value > 600_000) return;
  if (!["LCP", "CLS", "INP", "FCP", "TTFB"].includes(complete.metric)) return;

  buffer[head] = complete;
  head = (head + 1) % BUFFER_SIZE;
  if (count < BUFFER_SIZE) count++;
}

function freshSamples(windowMinutes: number = 60): CwvSample[] {
  const cutoff = Date.now() - windowMinutes * 60_000;
  const out: CwvSample[] = [];
  const start = count < BUFFER_SIZE ? 0 : head;
  for (let i = 0; i < count; i++) {
    const s = buffer[(start + i) % BUFFER_SIZE];
    if (s && s.timestamp >= cutoff) out.push(s);
  }
  return out;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// Core Web Vitals thresholds per Google Search Console
const THRESHOLDS: Record<CwvMetric, { good: number; needsImprovement: number }> = {
  LCP: { good: 2500, needsImprovement: 4000 },
  CLS: { good: 0.1, needsImprovement: 0.25 },
  INP: { good: 200, needsImprovement: 500 },
  FCP: { good: 1800, needsImprovement: 3000 },
  TTFB: { good: 800, needsImprovement: 1800 },
};

function classify(metric: CwvMetric, p75: number): "good" | "needs-improvement" | "poor" {
  const t = THRESHOLDS[metric];
  if (p75 <= t.good) return "good";
  if (p75 <= t.needsImprovement) return "needs-improvement";
  return "poor";
}

export interface CwvReport {
  windowMinutes: number;
  totalSamples: number;
  byMetric: Record<CwvMetric, {
    samples: number;
    p50: number;
    p75: number;
    p95: number;
    rating: "good" | "needs-improvement" | "poor" | "unavailable";
    threshold: { good: number; needsImprovement: number };
  }>;
  topSlowRoutes: Array<{ route: string; metric: CwvMetric; p75: number; samples: number }>;
  generatedAt: string;
}

export function getCwvReport(windowMinutes: number = 60): CwvReport {
  const samples = freshSamples(windowMinutes);
  const metrics: CwvMetric[] = ["LCP", "CLS", "INP", "FCP", "TTFB"];

  const byMetric = metrics.reduce((acc, m) => {
    const vals = samples.filter((s) => s.metric === m).map((s) => s.value);
    const p75 = percentile(vals, 75);
    acc[m] = {
      samples: vals.length,
      p50: Math.round(percentile(vals, 50) * 1000) / 1000,
      p75: Math.round(p75 * 1000) / 1000,
      p95: Math.round(percentile(vals, 95) * 1000) / 1000,
      // An empty buffer (fresh deploy, restart, idle window) must read as
      // unknown — percentile() returns 0 for no samples and 0 <= good, so
      // classify() alone rated a metric nobody measured as "good".
      rating: vals.length === 0 ? "unavailable" : classify(m, p75),
      threshold: THRESHOLDS[m],
    };
    return acc;
  }, {} as CwvReport["byMetric"]);

  // Slowest routes for LCP (the headline metric)
  const byRoute = new Map<string, { lcpValues: number[]; routeStr: string }>();
  for (const s of samples) {
    if (s.metric !== "LCP") continue;
    const entry = byRoute.get(s.route) ?? { lcpValues: [], routeStr: s.route };
    entry.lcpValues.push(s.value);
    byRoute.set(s.route, entry);
  }
  const topSlowRoutes = Array.from(byRoute.values())
    .filter((r) => r.lcpValues.length >= 3) // need enough samples to be meaningful
    .map((r) => ({
      route: r.routeStr,
      metric: "LCP" as const,
      p75: Math.round(percentile(r.lcpValues, 75)),
      samples: r.lcpValues.length,
    }))
    .sort((a, b) => b.p75 - a.p75)
    .slice(0, 10);

  return {
    windowMinutes,
    totalSamples: samples.length,
    byMetric,
    topSlowRoutes,
    generatedAt: new Date().toISOString(),
  };
}

/** Reset — only used in tests. */
export function resetCwvBuffer(): void {
  buffer.length = 0;
  head = 0;
  count = 0;
  log.info("CWV buffer reset");
}
