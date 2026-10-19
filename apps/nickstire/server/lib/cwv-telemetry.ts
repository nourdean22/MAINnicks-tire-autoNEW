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



// Core Web Vitals thresholds per Google Search Console


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

/** Reset — only used in tests. */
export function resetCwvBuffer(): void {
  buffer.length = 0;
  head = 0;
  count = 0;
  log.info("CWV buffer reset");
}
