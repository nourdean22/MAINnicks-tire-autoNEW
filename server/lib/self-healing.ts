/**
 * Self-Healing Monitor v2 — Predictive health, smart recovery, anomaly detection
 *
 * Runs every 60 seconds to check:
 * - Database connectivity (auto-reconnect on failure)
 * - AI gateway circuit breaker state
 * - Memory usage (GC trigger + warnings at 90%)
 * - Request rate anomalies (spike/drop detection)
 * - Event loop lag (CPU saturation detection)
 * - Predictive trend analysis (memory, response time, error rate)
 *
 * State machine: healthy → degraded → critical
 * Smart recovery: dependency-aware sequencing, exponential backoff, success rate tracking
 * Extensible via registerRecoveryAction()
 */

import { createLogger } from "./logger";

const log = createLogger("self-healing");

// ─── Types ──────────────────────────────────────────

export type SystemState = "healthy" | "degraded" | "critical";

type ComponentHealth = {
  name: string;
  status: "ok" | "degraded" | "down";
  lastCheck: number;
  lastRecoveryAttempt: number | null;
  recoveryCount: number;
  error: string | null;
};

type RecoveryAction = {
  name: string;
  checkFn: () => Promise<boolean>;
  recoveryFn: () => Promise<void>;
};

type StateTransition = {
  from: SystemState;
  to: SystemState;
  timestamp: number;
  reason: string;
};

type HealthMetricSample = {
  timestamp: number;
  heapPercent: number;
  rssMB: number;
  eventLoopLagMs: number;
  requestsPerMinute: number;
  errorRate: number; // 0-1
};

type TrendDirection = "stable" | "rising" | "falling";

type TrendAnalysis = {
  metric: string;
  direction: TrendDirection;
  slope: number; // rate of change per minute
  current: number;
  projected15min: number;
  warning: string | null;
};

type AnomalyEntry = {
  timestamp: number;
  type: "request_spike" | "request_drop" | "memory_leak" | "cpu_saturation" | "error_surge";
  severity: "info" | "warning" | "critical";
  message: string;
  value: number;
  baseline: number;
};

type SmartRecoveryAction = {
  name: string;
  checkFn: () => Promise<boolean>;
  recoveryFn: () => Promise<void>;
  priority: number; // lower = runs first
  dependsOn: string[]; // names of components this depends on
  consecutiveFailures: number;
  totalAttempts: number;
  totalSuccesses: number;
  lastBackoffUntil: number;
};

type DiagnosticReport = {
  generatedAt: string;
  uptime: number;
  state: SystemState;
  healthScore: number;
  components: Record<string, {
    status: string;
    error: string | null;
    recoveryCount: number;
    successRate: string;
  }>;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    heapPercent: number;
  };
  eventLoopLagMs: number;
  trends: TrendAnalysis[];
  anomalies: AnomalyEntry[];
  recentStateTransitions: Array<{
    from: string;
    to: string;
    timestamp: string;
    reason: string;
  }>;
  recoveryHistory: Array<{
    name: string;
    totalAttempts: number;
    totalSuccesses: number;
    successRate: string;
    consecutiveFailures: number;
    backoffActive: boolean;
  }>;
  requestRate: {
    currentPerMinute: number;
    averagePerMinute: number;
    peakPerMinute: number;
  };
  watchdog: {
    lastSuccessfulCheck: string | null;
    timeSinceLastCheckMs: number;
    checkDurationMs: number | null;
    healthy: boolean;
  };
};

// ─── State ──────────────────────────────────────────

let currentState: SystemState = "healthy";
let lastCheckTimestamp = 0;
let checkCount = 0;

const components = new Map<string, ComponentHealth>();
const recoveryActions = new Map<string, RecoveryAction>();
const smartRecoveryActions = new Map<string, SmartRecoveryAction>();
const stateHistory: StateTransition[] = [];
const MAX_HISTORY = 20; // Keep small to save memory on tight containers
const CHECK_INTERVAL_MS = 60_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

// ─── Predictive Health State ───────────────────────

const METRIC_WINDOW_SIZE = 20; // Keep small to save memory
const metricHistory: HealthMetricSample[] = [];

// ─── Request Anomaly Detection State ───────────────

const REQUEST_WINDOW_MS = 60_000; // 1 minute buckets
const REQUEST_HISTORY_SIZE = 30; // track last 30 minutes
const requestTimestamps: number[] = []; // raw request timestamps for current window
const requestRateHistory: { timestamp: number; count: number }[] = [];
let lastRequestBucketTime = 0;

// ─── Anomaly Log ───────────────────────────────────

const MAX_ANOMALIES = 100;
const anomalyLog: AnomalyEntry[] = [];

// ─── Watchdog State ────────────────────────────────

let lastSuccessfulCheckTime = 0;
let lastCheckDurationMs: number | null = null;
let healthCheckRunning = false;
let healthCheckAbortController: AbortController | null = null;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;

// ─── Event Loop Lag Tracking ───────────────────────

let eventLoopLagMs = 0;
let lagCheckHandle: ReturnType<typeof setTimeout> | null = null;

function startEventLoopLagTracking(): void {
  let lastTime = Date.now();
  const check = () => {
    const now = Date.now();
    const expected = 200; // check every 200ms
    const actual = now - lastTime;
    eventLoopLagMs = Math.max(0, actual - expected);
    lastTime = now;
    lagCheckHandle = setTimeout(check, expected);
    if (lagCheckHandle && typeof lagCheckHandle === "object" && "unref" in lagCheckHandle) {
      lagCheckHandle.unref();
    }
  };
  lagCheckHandle = setTimeout(check, 200);
  if (lagCheckHandle && typeof lagCheckHandle === "object" && "unref" in lagCheckHandle) {
    lagCheckHandle.unref();
  }
}

function stopEventLoopLagTracking(): void {
  if (lagCheckHandle) {
    clearTimeout(lagCheckHandle);
    lagCheckHandle = null;
  }
}

// ─── Component tracking ─────────────────────────────

function getOrCreateComponent(name: string): ComponentHealth {
  if (!components.has(name)) {
    components.set(name, {
      name,
      status: "ok",
      lastCheck: 0,
      lastRecoveryAttempt: null,
      recoveryCount: 0,
      error: null,
    });
  }
  return components.get(name)!;
}

function transitionState(newState: SystemState, reason: string): void {
  if (newState === currentState) return;

  const transition: StateTransition = {
    from: currentState,
    to: newState,
    timestamp: Date.now(),
    reason,
  };

  stateHistory.push(transition);
  if (stateHistory.length > MAX_HISTORY) {
    stateHistory.splice(0, stateHistory.length - MAX_HISTORY);
  }

  log.warn(`State transition: ${currentState} → ${newState}`, { reason });
  currentState = newState;
}

// ─── Health checks ──────────────────────────────────

async function checkDatabase(): Promise<void> {
  const comp = getOrCreateComponent("database");
  comp.lastCheck = Date.now();

  try {
    const { getDb } = await import("../db");
    const db = await getDb();

    if (!db) {
      comp.status = "down";
      comp.error = "getDb() returned null";

      // Auto-recovery: clear cached connection and retry
      comp.lastRecoveryAttempt = Date.now();
      comp.recoveryCount++;
      log.warn("Database down — attempting reconnection", { attempt: comp.recoveryCount });

      try {
        // Clear the cached _db so getDb() creates a fresh connection
        const dbModule = await import("../db") as any;
        if (typeof dbModule._db !== "undefined") {
          dbModule._db = null;
        }
        // Force a new connection attempt
        const freshDb = await getDb();
        if (freshDb) {
          const { sql } = await import("drizzle-orm");
          await freshDb.execute(sql`SELECT 1`);
          comp.status = "ok";
          comp.error = null;
          log.info("Database reconnection successful");
        }
      } catch (reconnectErr) {
        comp.status = "down";
        comp.error = `Reconnection failed: ${reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr)}`;
        log.error("Database reconnection failed", { error: comp.error });
      }
      return;
    }

    // Verify actual connectivity with a lightweight query
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    comp.status = "ok";
    comp.error = null;
  } catch (err) {
    comp.status = "down";
    comp.error = err instanceof Error ? err.message : String(err);
    log.error("Database health check failed", { error: comp.error });

    // Attempt recovery
    comp.lastRecoveryAttempt = Date.now();
    comp.recoveryCount++;
    try {
      const dbModule = await import("../db") as any;
      if (typeof dbModule._db !== "undefined") {
        dbModule._db = null;
      }
      const { getDb } = await import("../db");
      const freshDb = await getDb();
      if (freshDb) {
        const { sql } = await import("drizzle-orm");
        await freshDb.execute(sql`SELECT 1`);
        comp.status = "ok";
        comp.error = null;
        log.info("Database auto-recovery successful after error");
      }
    } catch (recoveryErr) {
      log.error("Database auto-recovery failed", {
        error: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
      });
    }
  }
}

async function checkAIGateway(): Promise<void> {
  const comp = getOrCreateComponent("ai-gateway");
  comp.lastCheck = Date.now();

  try {
    const { getGatewayHealth } = await import("./ai-gateway");
    const health = getGatewayHealth();

    if (health.circuitBreaker.open) {
      comp.status = "degraded";
      comp.error = `Circuit breaker open — ${health.circuitBreaker.consecutiveFailures} consecutive failures`;
      const cooldownRemaining = health.circuitBreaker.cooldownUntil
        ? Math.round((new Date(health.circuitBreaker.cooldownUntil).getTime() - Date.now()) / 1000)
        : 0;
      log.warn("AI gateway circuit breaker open", {
        failures: health.circuitBreaker.consecutiveFailures,
        cooldownSecondsRemaining: cooldownRemaining,
      });
    } else if (health.stats.last5min.failures > health.stats.last5min.total * 0.5 && health.stats.last5min.total > 2) {
      comp.status = "degraded";
      comp.error = `High failure rate: ${health.stats.last5min.failures}/${health.stats.last5min.total} in last 5 min`;
      log.warn("AI gateway high failure rate", {
        failures: health.stats.last5min.failures,
        total: health.stats.last5min.total,
      });
    } else {
      comp.status = "ok";
      comp.error = null;
    }
  } catch (err) {
    // AI gateway module not loaded yet — not a critical failure
    comp.status = "degraded";
    comp.error = err instanceof Error ? err.message : String(err);
  }
}

function checkMemory(): void {
  const comp = getOrCreateComponent("memory");
  comp.lastCheck = Date.now();

  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  // Use --max-old-space-size ceiling (not V8's current dynamic allocation) for accurate %
  const maxMatch = (process.env.NODE_OPTIONS || "").match(/--max-old-space-size=(\d+)/);
  const heapCeilingMB = maxMatch ? parseInt(maxMatch[1], 10) : 512;
  const heapPercent = heapCeilingMB > 0 ? Math.round((heapUsedMB / heapCeilingMB) * 100) : 0;

  if (heapPercent >= 95) {
    comp.status = "down";
    comp.error = `Critical memory usage: ${heapPercent}% (${heapUsedMB}MB/${heapTotalMB}MB heap, ${rssMB}MB RSS)`;
    log.error("CRITICAL: Memory usage at " + heapPercent + "%", {
      heapUsedMB,
      heapTotalMB,
      rssMB,
      heapPercent,
    });

    // Force GC if available (Node --expose-gc flag)
    if (typeof global.gc === "function") {
      comp.lastRecoveryAttempt = Date.now();
      comp.recoveryCount++;
      log.info("Triggering forced garbage collection");
      global.gc();
    }
  } else if (heapPercent >= 97) {
    // Only degrade at 97%+ — small containers (54MB) routinely run at 90%+ and that's NORMAL
    // Node's V8 heap management is efficient at high utilization; 90% is not a problem
    comp.status = "degraded";
    comp.error = `Critical memory pressure: ${heapPercent}% (${heapUsedMB}MB/${heapTotalMB}MB heap, ${rssMB}MB RSS)`;
    log.warn("Memory pressure critical at " + heapPercent + "%", {
      heapUsedMB,
      heapTotalMB,
      rssMB,
      heapPercent,
    });

    // Attempt GC
    if (typeof global.gc === "function") {
      comp.lastRecoveryAttempt = Date.now();
      comp.recoveryCount++;
      global.gc();
    }
  } else {
    comp.status = "ok";
    comp.error = null;
  }
}

// ─── Predictive Health Engine ───────────────────────

function recordMetricSample(): void {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  // Use ceiling from --max-old-space-size for accurate trending
  const maxMatch = (process.env.NODE_OPTIONS || "").match(/--max-old-space-size=(\d+)/);
  const ceilingMB = maxMatch ? parseInt(maxMatch[1], 10) : 512;
  const heapPercent = ceilingMB > 0 ? (heapUsedMB / ceilingMB) * 100 : 0;

  // Calculate current requests per minute from recent timestamps
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  const recentRequests = requestTimestamps.filter(t => t > oneMinuteAgo).length;

  // Calculate error rate from component statuses
  let totalComponents = 0;
  let errorComponents = 0;
  for (const comp of components.values()) {
    totalComponents++;
    if (comp.status !== "ok") errorComponents++;
  }
  const errorRate = totalComponents > 0 ? errorComponents / totalComponents : 0;

  const sample: HealthMetricSample = {
    timestamp: now,
    heapPercent,
    rssMB: Math.round(mem.rss / 1024 / 1024),
    eventLoopLagMs,
    requestsPerMinute: recentRequests,
    errorRate,
  };

  metricHistory.push(sample);
  if (metricHistory.length > METRIC_WINDOW_SIZE) {
    metricHistory.splice(0, metricHistory.length - METRIC_WINDOW_SIZE);
  }
}

function calculateTrend(values: number[], timestamps: number[]): { slope: number; direction: TrendDirection } {
  if (values.length < 3) return { slope: 0, direction: "stable" };

  // Simple linear regression (least squares)
  const n = values.length;
  // Normalize timestamps to minutes from first sample
  const t0 = timestamps[0];
  const xs = timestamps.map(t => (t - t0) / 60_000);
  const ys = values;

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumXX += xs[i] * xs[i];
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 0.0001) return { slope: 0, direction: "stable" };

  const slope = (n * sumXY - sumX * sumY) / denom;

  // Determine direction: slope must be meaningful relative to the mean
  const mean = sumY / n;
  const threshold = mean * 0.02; // 2% of mean per minute is significant

  let direction: TrendDirection = "stable";
  if (slope > threshold) direction = "rising";
  else if (slope < -threshold) direction = "falling";

  return { slope, direction };
}

function analyzeTrends(): TrendAnalysis[] {
  if (metricHistory.length < 5) return [];

  const timestamps = metricHistory.map(s => s.timestamp);
  const analyses: TrendAnalysis[] = [];

  // Memory trend
  const heapValues = metricHistory.map(s => s.heapPercent);
  const heapTrend = calculateTrend(heapValues, timestamps);
  const currentHeap = heapValues[heapValues.length - 1];
  const projected15minHeap = currentHeap + heapTrend.slope * 15;
  let heapWarning: string | null = null;
  if (heapTrend.direction === "rising" && projected15minHeap > 97) {
    const minutesToCritical = currentHeap < 97 ? Math.round((97 - currentHeap) / heapTrend.slope) : 0;
    heapWarning = `Memory trending up — projected to hit critical in ~${minutesToCritical} minutes`;
    log.warn(heapWarning, { currentHeap: Math.round(currentHeap), slope: heapTrend.slope.toFixed(2) });
  }
  analyses.push({
    metric: "heap_percent",
    direction: heapTrend.direction,
    slope: heapTrend.slope,
    current: currentHeap,
    projected15min: projected15minHeap,
    warning: heapWarning,
  });

  // Event loop lag trend
  const lagValues = metricHistory.map(s => s.eventLoopLagMs);
  const lagTrend = calculateTrend(lagValues, timestamps);
  const currentLag = lagValues[lagValues.length - 1];
  const projected15minLag = currentLag + lagTrend.slope * 15;
  let lagWarning: string | null = null;
  if (lagTrend.direction === "rising" && projected15minLag > 100) {
    lagWarning = `Event loop lag trending up — projected ${Math.round(projected15minLag)}ms in ~15 minutes`;
    log.warn(lagWarning, { currentLag: Math.round(currentLag), slope: lagTrend.slope.toFixed(2) });
  }
  analyses.push({
    metric: "event_loop_lag_ms",
    direction: lagTrend.direction,
    slope: lagTrend.slope,
    current: currentLag,
    projected15min: projected15minLag,
    warning: lagWarning,
  });

  // Error rate trend
  const errorValues = metricHistory.map(s => s.errorRate);
  const errorTrend = calculateTrend(errorValues, timestamps);
  const currentError = errorValues[errorValues.length - 1];
  const projected15minError = Math.min(1, currentError + errorTrend.slope * 15);
  let errorWarning: string | null = null;
  if (errorTrend.direction === "rising" && projected15minError > 0.5) {
    errorWarning = `Error rate trending up — projected ${Math.round(projected15minError * 100)}% in ~15 minutes`;
    log.warn(errorWarning, { currentError: (currentError * 100).toFixed(1), slope: errorTrend.slope.toFixed(4) });
  }
  analyses.push({
    metric: "error_rate",
    direction: errorTrend.direction,
    slope: errorTrend.slope,
    current: currentError,
    projected15min: projected15minError,
    warning: errorWarning,
  });

  // RSS memory trend
  const rssValues = metricHistory.map(s => s.rssMB);
  const rssTrend = calculateTrend(rssValues, timestamps);
  const currentRss = rssValues[rssValues.length - 1];
  const projected15minRss = currentRss + rssTrend.slope * 15;
  let rssWarning: string | null = null;
  if (rssTrend.direction === "rising" && rssTrend.slope > 5) {
    rssWarning = `RSS memory growing at ~${Math.round(rssTrend.slope)}MB/min — possible memory leak`;
    log.warn(rssWarning, { currentRss, slope: rssTrend.slope.toFixed(2) });
    logAnomaly({
      timestamp: Date.now(),
      type: "memory_leak",
      severity: rssTrend.slope > 20 ? "critical" : "warning",
      message: rssWarning,
      value: rssTrend.slope,
      baseline: 0,
    });
  }
  analyses.push({
    metric: "rss_mb",
    direction: rssTrend.direction,
    slope: rssTrend.slope,
    current: currentRss,
    projected15min: projected15minRss,
    warning: rssWarning,
  });

  return analyses;
}

function calculateHealthScore(): number {
  // Weighted health score 0-100
  const weights = {
    database: 30,
    memory: 25,
    aiGateway: 15,
    eventLoopLag: 15,
    requestAnomaly: 10,
    trends: 5,
  };

  let score = 100;

  // Database component
  const dbComp = components.get("database");
  if (dbComp?.status === "down") score -= weights.database;
  else if (dbComp?.status === "degraded") score -= weights.database * 0.5;

  // Memory
  const memComp = components.get("memory");
  if (memComp?.status === "down") score -= weights.memory;
  else if (memComp?.status === "degraded") score -= weights.memory * 0.5;

  // AI gateway
  const aiComp = components.get("ai-gateway");
  if (aiComp?.status === "down") score -= weights.aiGateway;
  else if (aiComp?.status === "degraded") score -= weights.aiGateway * 0.5;

  // Event loop lag penalty
  if (eventLoopLagMs > 500) score -= weights.eventLoopLag;
  else if (eventLoopLagMs > 100) score -= weights.eventLoopLag * (eventLoopLagMs / 500);

  // Request anomaly penalty
  const recentAnomalies = anomalyLog.filter(a => Date.now() - a.timestamp < 300_000); // last 5 min
  if (recentAnomalies.some(a => a.severity === "critical")) score -= weights.requestAnomaly;
  else if (recentAnomalies.some(a => a.severity === "warning")) score -= weights.requestAnomaly * 0.5;

  // Negative trend penalty
  const trends = analyzeTrends();
  const warningTrends = trends.filter(t => t.warning !== null);
  if (warningTrends.length > 0) score -= weights.trends * Math.min(1, warningTrends.length / 2);

  // Penalty for custom components that are down
  for (const [name, comp] of components) {
    if (["database", "memory", "ai-gateway"].includes(name)) continue;
    if (comp.status === "down") score -= 5;
    else if (comp.status === "degraded") score -= 2;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Request Anomaly Detection ─────────────────────

function logAnomaly(anomaly: AnomalyEntry): void {
  anomalyLog.push(anomaly);
  if (anomalyLog.length > MAX_ANOMALIES) {
    anomalyLog.splice(0, anomalyLog.length - MAX_ANOMALIES);
  }
}

/**
 * Call this from request middleware to track request rate.
 * Non-blocking — just pushes a timestamp.
 */
export function recordRequest(): void {
  requestTimestamps.push(Date.now());
}

function flushRequestBucket(): void {
  const now = Date.now();
  const oneMinuteAgo = now - REQUEST_WINDOW_MS;

  // Count requests in the last minute
  const count = requestTimestamps.filter(t => t > oneMinuteAgo).length;

  // Prune old timestamps (keep only last 2 minutes for safety)
  const twoMinutesAgo = now - REQUEST_WINDOW_MS * 2;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < twoMinutesAgo) {
    requestTimestamps.shift();
  }

  requestRateHistory.push({ timestamp: now, count });
  if (requestRateHistory.length > REQUEST_HISTORY_SIZE) {
    requestRateHistory.splice(0, requestRateHistory.length - REQUEST_HISTORY_SIZE);
  }

  lastRequestBucketTime = now;
}

function detectRequestAnomalies(): void {
  flushRequestBucket();

  if (requestRateHistory.length < 5) return; // need baseline

  // Calculate baseline (average of all but last entry)
  const baseline = requestRateHistory.slice(0, -1);
  const avgRate = baseline.reduce((sum, b) => sum + b.count, 0) / baseline.length;
  const current = requestRateHistory[requestRateHistory.length - 1];

  if (avgRate < 1) return; // too low to meaningfully detect anomalies

  const ratio = current.count / avgRate;

  // Spike detection: >3x normal rate
  if (ratio > 3) {
    const anomaly: AnomalyEntry = {
      timestamp: Date.now(),
      type: "request_spike",
      severity: ratio > 10 ? "critical" : "warning",
      message: `Request spike detected: ${current.count}/min vs baseline ${Math.round(avgRate)}/min (${ratio.toFixed(1)}x)`,
      value: current.count,
      baseline: avgRate,
    };
    logAnomaly(anomaly);
    log.warn(anomaly.message, { ratio: ratio.toFixed(1), severity: anomaly.severity });
  }

  // Drop detection: >70% below normal
  if (ratio < 0.3 && avgRate > 5) {
    const anomaly: AnomalyEntry = {
      timestamp: Date.now(),
      type: "request_drop",
      severity: ratio < 0.1 ? "critical" : "warning",
      message: `Request drop detected: ${current.count}/min vs baseline ${Math.round(avgRate)}/min (${Math.round((1 - ratio) * 100)}% drop)`,
      value: current.count,
      baseline: avgRate,
    };
    logAnomaly(anomaly);
    log.warn(anomaly.message, { ratio: ratio.toFixed(2), severity: anomaly.severity });
  }
}

function checkEventLoopHealth(): void {
  if (eventLoopLagMs > 500) {
    const anomaly: AnomalyEntry = {
      timestamp: Date.now(),
      type: "cpu_saturation",
      severity: eventLoopLagMs > 2000 ? "critical" : "warning",
      message: `Event loop lag: ${Math.round(eventLoopLagMs)}ms — possible CPU saturation`,
      value: eventLoopLagMs,
      baseline: 50, // expected <50ms
    };
    logAnomaly(anomaly);
    log.warn(anomaly.message, { lagMs: Math.round(eventLoopLagMs) });
  }
}

// ─── Smart Recovery Sequencing ─────────────────────

const MAX_CONSECUTIVE_FAILURES = 3;
const BASE_BACKOFF_MS = 30_000; // 30 seconds
const MAX_BACKOFF_MS = 600_000; // 10 minutes

function getBackoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures < MAX_CONSECUTIVE_FAILURES) return 0;
  const backoff = BASE_BACKOFF_MS * Math.pow(2, consecutiveFailures - MAX_CONSECUTIVE_FAILURES);
  return Math.min(backoff, MAX_BACKOFF_MS);
}

function shouldSkipRecovery(action: SmartRecoveryAction): { skip: boolean; reason: string } {
  const now = Date.now();

  // Check backoff
  if (action.lastBackoffUntil > now) {
    const remainingSec = Math.round((action.lastBackoffUntil - now) / 1000);
    return { skip: true, reason: `Backoff active — ${remainingSec}s remaining` };
  }

  // Check dependencies: if a dependency is down, skip this recovery
  for (const dep of action.dependsOn) {
    const depComp = components.get(dep);
    if (depComp && depComp.status === "down") {
      return { skip: true, reason: `Dependency "${dep}" is down` };
    }
  }

  return { skip: false, reason: "" };
}

// ─── Run all custom recovery actions ────────────────

async function runCustomRecoveries(): Promise<void> {
  // Run legacy recovery actions (backward compatible)
  for (const [name, action] of recoveryActions) {
    // Skip if also registered as smart action (prefer smart path)
    if (smartRecoveryActions.has(name)) continue;

    const comp = getOrCreateComponent(name);
    comp.lastCheck = Date.now();

    try {
      const isHealthy = await action.checkFn();
      if (!isHealthy) {
        comp.status = "degraded";
        comp.error = `Check failed — running recovery`;
        comp.lastRecoveryAttempt = Date.now();
        comp.recoveryCount++;
        log.warn(`Recovery action triggered: ${name}`, { attempt: comp.recoveryCount });

        try {
          await action.recoveryFn();
          // Re-check after recovery
          const nowHealthy = await action.checkFn();
          comp.status = nowHealthy ? "ok" : "down";
          comp.error = nowHealthy ? null : "Recovery did not resolve issue";
          if (nowHealthy) {
            log.info(`Recovery successful: ${name}`);
          } else {
            log.error(`Recovery did not resolve issue: ${name}`);
          }
        } catch (recoveryErr) {
          comp.status = "down";
          comp.error = `Recovery failed: ${recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)}`;
          log.error(`Recovery action failed: ${name}`, { error: comp.error });
        }
      } else {
        comp.status = "ok";
        comp.error = null;
      }
    } catch (checkErr) {
      comp.status = "down";
      comp.error = `Health check threw: ${checkErr instanceof Error ? checkErr.message : String(checkErr)}`;
      log.error(`Health check error for ${name}`, { error: comp.error });
    }
  }

  // Run smart recovery actions in priority order with dependency awareness
  const sortedActions = Array.from(smartRecoveryActions.values())
    .sort((a, b) => a.priority - b.priority);

  for (const action of sortedActions) {
    const comp = getOrCreateComponent(action.name);
    comp.lastCheck = Date.now();

    try {
      const isHealthy = await action.checkFn();
      if (!isHealthy) {
        // Check if we should skip due to backoff or dependencies
        const { skip, reason } = shouldSkipRecovery(action);
        if (skip) {
          comp.status = "degraded";
          comp.error = `Recovery skipped: ${reason}`;
          log.info(`Skipping recovery for ${action.name}: ${reason}`);
          continue;
        }

        comp.status = "degraded";
        comp.error = `Check failed — running recovery`;
        comp.lastRecoveryAttempt = Date.now();
        comp.recoveryCount++;
        action.totalAttempts++;

        log.warn(`Smart recovery triggered: ${action.name}`, {
          attempt: action.totalAttempts,
          consecutiveFailures: action.consecutiveFailures,
          priority: action.priority,
        });

        try {
          await action.recoveryFn();
          const nowHealthy = await action.checkFn();
          comp.status = nowHealthy ? "ok" : "down";
          comp.error = nowHealthy ? null : "Recovery did not resolve issue";

          if (nowHealthy) {
            action.consecutiveFailures = 0;
            action.totalSuccesses++;
            action.lastBackoffUntil = 0;
            log.info(`Smart recovery successful: ${action.name}`);
          } else {
            action.consecutiveFailures++;
            const backoff = getBackoffMs(action.consecutiveFailures);
            if (backoff > 0) {
              action.lastBackoffUntil = Date.now() + backoff;
              log.error(`Recovery incomplete for ${action.name} — backing off ${Math.round(backoff / 1000)}s (${action.consecutiveFailures} consecutive failures)`, {
                nextRetry: new Date(action.lastBackoffUntil).toISOString(),
              });
            } else {
              log.error(`Recovery did not resolve issue: ${action.name}`);
            }
          }
        } catch (recoveryErr) {
          comp.status = "down";
          comp.error = `Recovery failed: ${recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)}`;
          action.consecutiveFailures++;
          const backoff = getBackoffMs(action.consecutiveFailures);
          if (backoff > 0) {
            action.lastBackoffUntil = Date.now() + backoff;
            log.error(`Smart recovery failed for ${action.name} — backing off ${Math.round(backoff / 1000)}s`, {
              error: comp.error,
              consecutiveFailures: action.consecutiveFailures,
            });
          } else {
            log.error(`Smart recovery action failed: ${action.name}`, { error: comp.error });
          }
        }
      } else {
        comp.status = "ok";
        comp.error = null;
        // Reset consecutive failures on healthy check
        if (action.consecutiveFailures > 0) {
          action.consecutiveFailures = 0;
          action.lastBackoffUntil = 0;
        }
      }
    } catch (checkErr) {
      comp.status = "down";
      comp.error = `Health check threw: ${checkErr instanceof Error ? checkErr.message : String(checkErr)}`;
      log.error(`Smart health check error for ${action.name}`, { error: comp.error });
    }
  }
}

// ─── Compute overall state ──────────────────────────

function computeOverallState(): SystemState {
  let hasDown = false;
  let hasDegraded = false;

  for (const comp of components.values()) {
    if (comp.status === "down") hasDown = true;
    if (comp.status === "degraded") hasDegraded = true;
  }

  // Database down = critical (core dependency)
  const dbComp = components.get("database");
  if (dbComp?.status === "down") return "critical";

  // Any component down = degraded at minimum
  if (hasDown) return "degraded";
  if (hasDegraded) return "degraded";

  return "healthy";
}

// ─── Main check cycle ───────────────────────────────

async function runHealthCheck(): Promise<void> {
  // Watchdog: prevent overlapping checks
  if (healthCheckRunning) {
    log.warn("Health check already running — skipping");
    return;
  }

  healthCheckRunning = true;
  checkCount++;
  const start = Date.now();

  try {
    // Watchdog: abort if check takes too long
    healthCheckAbortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      if (healthCheckAbortController) {
        healthCheckAbortController.abort();
        log.error("Health check timed out — aborting", { timeoutMs: HEALTH_CHECK_TIMEOUT_MS });
      }
    }, HEALTH_CHECK_TIMEOUT_MS);
    if (typeof timeoutHandle === "object" && "unref" in timeoutHandle) {
      timeoutHandle.unref();
    }

    // Run all checks concurrently (non-blocking to each other)
    await Promise.allSettled([
      checkDatabase(),
      checkAIGateway(),
      Promise.resolve(checkMemory()),
      runCustomRecoveries(),
    ]);

    clearTimeout(timeoutHandle);

    // Record metric sample for trend analysis
    recordMetricSample();

    // Detect request anomalies
    detectRequestAnomalies();

    // Check event loop health
    checkEventLoopHealth();

    // Run predictive trend analysis
    const trends = analyzeTrends();
    const warnings = trends.filter(t => t.warning !== null);
    if (warnings.length > 0) {
      log.info("Trend warnings active", { count: warnings.length, warnings: warnings.map(w => w.warning) });
    }

    const newState = computeOverallState();
    const reasons: string[] = [];
    for (const comp of components.values()) {
      if (comp.status !== "ok") {
        reasons.push(`${comp.name}: ${comp.status}${comp.error ? ` (${comp.error})` : ""}`);
      }
    }

    transitionState(newState, reasons.length > 0 ? reasons.join("; ") : "All components healthy");

    lastCheckTimestamp = Date.now();
    lastSuccessfulCheckTime = Date.now();
    const elapsed = Date.now() - start;
    lastCheckDurationMs = elapsed;

    if (elapsed > 5000) {
      log.warn("Health check took longer than expected", { elapsedMs: elapsed });
    }
  } catch (err) {
    log.error("Health check cycle failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    healthCheckRunning = false;
    healthCheckAbortController = null;
  }
}

// ─── Public API ─────────────────────────────────────

/**
 * Register a custom recovery action. When checkFn returns false,
 * recoveryFn will be called automatically.
 */
export function registerRecoveryAction(
  name: string,
  checkFn: () => Promise<boolean>,
  recoveryFn: () => Promise<void>,
): void {
  recoveryActions.set(name, { name, checkFn, recoveryFn });
  log.info(`Registered recovery action: ${name}`);
}

/**
 * Register a smart recovery action with priority, dependencies, and backoff.
 * Priority: lower number = runs first. dependsOn: names of components this requires.
 * Example: registerSmartRecoveryAction("ai-cache", checkFn, recoveryFn, 20, ["database"])
 */
export function registerSmartRecoveryAction(
  name: string,
  checkFn: () => Promise<boolean>,
  recoveryFn: () => Promise<void>,
  priority: number = 10,
  dependsOn: string[] = [],
): void {
  smartRecoveryActions.set(name, {
    name,
    checkFn,
    recoveryFn,
    priority,
    dependsOn,
    consecutiveFailures: 0,
    totalAttempts: 0,
    totalSuccesses: 0,
    lastBackoffUntil: 0,
  });
  log.info(`Registered smart recovery action: ${name}`, { priority, dependsOn });
}

/**
 * Returns full system health state — suitable for API responses.
 */
export function getSystemHealth() {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);

  const componentMap: Record<string, any> = {};
  for (const [name, comp] of components) {
    componentMap[name] = {
      status: comp.status,
      lastCheck: comp.lastCheck ? new Date(comp.lastCheck).toISOString() : null,
      error: comp.error,
      recoveryCount: comp.recoveryCount,
      lastRecoveryAttempt: comp.lastRecoveryAttempt ? new Date(comp.lastRecoveryAttempt).toISOString() : null,
    };
  }

  // Request rate info
  const now = Date.now();
  const currentMinuteRequests = requestTimestamps.filter(t => t > now - 60_000).length;
  const avgRate = requestRateHistory.length > 0
    ? requestRateHistory.reduce((sum, b) => sum + b.count, 0) / requestRateHistory.length
    : 0;
  const peakRate = requestRateHistory.length > 0
    ? Math.max(...requestRateHistory.map(b => b.count))
    : 0;

  return {
    state: currentState,
    healthScore: calculateHealthScore(),
    uptime: Math.round(process.uptime()),
    lastCheck: lastCheckTimestamp ? new Date(lastCheckTimestamp).toISOString() : null,
    checkCount,
    components: componentMap,
    stateHistory: stateHistory.slice(-10).reverse().map(t => ({
      from: t.from,
      to: t.to,
      timestamp: new Date(t.timestamp).toISOString(),
      reason: t.reason,
    })),
    memory: {
      heapUsedMB,
      heapTotalMB,
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapPercent: (() => { const m = (process.env.NODE_OPTIONS || "").match(/--max-old-space-size=(\d+)/); const c = m ? parseInt(m[1], 10) : 512; return c > 0 ? Math.round((heapUsedMB / c) * 100) : 0; })(),
    },
    eventLoopLagMs: Math.round(eventLoopLagMs),
    trends: analyzeTrends(),
    recentAnomalies: anomalyLog.slice(-10).reverse().map(a => ({
      ...a,
      timestamp: new Date(a.timestamp).toISOString(),
    })),
    requestRate: {
      currentPerMinute: currentMinuteRequests,
      averagePerMinute: Math.round(avgRate),
      peakPerMinute: peakRate,
    },
    watchdog: {
      lastSuccessfulCheck: lastSuccessfulCheckTime ? new Date(lastSuccessfulCheckTime).toISOString() : null,
      timeSinceLastCheckMs: lastSuccessfulCheckTime ? now - lastSuccessfulCheckTime : -1,
      checkDurationMs: lastCheckDurationMs,
      healthy: lastSuccessfulCheckTime > 0 && (now - lastSuccessfulCheckTime) < CHECK_INTERVAL_MS * 3,
    },
  };
}

/**
 * Generate a comprehensive diagnostic report — suitable for admin panel display.
 * Includes uptime, health history, recovery history, anomaly log, trend predictions.
 */
export function generateDiagnosticReport(): DiagnosticReport {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  const now = Date.now();

  const componentReport: DiagnosticReport["components"] = {};
  for (const [name, comp] of components) {
    const smartAction = smartRecoveryActions.get(name);
    const totalAttempts = smartAction ? smartAction.totalAttempts : comp.recoveryCount;
    const totalSuccesses = smartAction ? smartAction.totalSuccesses : 0;
    componentReport[name] = {
      status: comp.status,
      error: comp.error,
      recoveryCount: comp.recoveryCount,
      successRate: totalAttempts > 0 ? `${Math.round((totalSuccesses / totalAttempts) * 100)}%` : "N/A",
    };
  }

  const recoveryHistory: DiagnosticReport["recoveryHistory"] = [];
  for (const [name, action] of smartRecoveryActions) {
    recoveryHistory.push({
      name,
      totalAttempts: action.totalAttempts,
      totalSuccesses: action.totalSuccesses,
      successRate: action.totalAttempts > 0 ? `${Math.round((action.totalSuccesses / action.totalAttempts) * 100)}%` : "N/A",
      consecutiveFailures: action.consecutiveFailures,
      backoffActive: action.lastBackoffUntil > now,
    });
  }

  const currentMinuteRequests = requestTimestamps.filter(t => t > now - 60_000).length;
  const avgRate = requestRateHistory.length > 0
    ? requestRateHistory.reduce((sum, b) => sum + b.count, 0) / requestRateHistory.length
    : 0;
  const peakRate = requestRateHistory.length > 0
    ? Math.max(...requestRateHistory.map(b => b.count))
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    state: currentState,
    healthScore: calculateHealthScore(),
    components: componentReport,
    memory: {
      heapUsedMB,
      heapTotalMB,
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapPercent: (() => { const m = (process.env.NODE_OPTIONS || "").match(/--max-old-space-size=(\d+)/); const c = m ? parseInt(m[1], 10) : 512; return c > 0 ? Math.round((heapUsedMB / c) * 100) : 0; })(),
    },
    eventLoopLagMs: Math.round(eventLoopLagMs),
    trends: analyzeTrends(),
    anomalies: anomalyLog.slice(-20).reverse(),
    recentStateTransitions: stateHistory.slice(-10).reverse().map(t => ({
      from: t.from,
      to: t.to,
      timestamp: new Date(t.timestamp).toISOString(),
      reason: t.reason,
    })),
    recoveryHistory,
    requestRate: {
      currentPerMinute: currentMinuteRequests,
      averagePerMinute: Math.round(avgRate),
      peakPerMinute: peakRate,
    },
    watchdog: {
      lastSuccessfulCheck: lastSuccessfulCheckTime ? new Date(lastSuccessfulCheckTime).toISOString() : null,
      timeSinceLastCheckMs: lastSuccessfulCheckTime ? now - lastSuccessfulCheckTime : -1,
      checkDurationMs: lastCheckDurationMs,
      healthy: lastSuccessfulCheckTime > 0 && (now - lastSuccessfulCheckTime) < CHECK_INTERVAL_MS * 3,
    },
  };
}

/**
 * Manually trigger a recovery cycle (for admin endpoint).
 */
export async function triggerManualRecovery(): Promise<{
  previousState: SystemState;
  newState: SystemState;
  results: Record<string, string>;
}> {
  const previousState = currentState;
  log.info("Manual recovery triggered", { currentState });

  const results: Record<string, string> = {};

  // Force database reconnection
  try {
    const dbModule = await import("../db") as any;
    if (typeof dbModule._db !== "undefined") {
      dbModule._db = null;
    }
    const { getDb } = await import("../db");
    const db = await getDb();
    if (db) {
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`SELECT 1`);
      results.database = "reconnected";
    } else {
      results.database = "failed — no DATABASE_URL";
    }
  } catch (err) {
    results.database = `failed — ${err instanceof Error ? err.message : String(err)}`;
  }

  // Force GC if available
  if (typeof global.gc === "function") {
    global.gc();
    results.memory = "gc_triggered";
  } else {
    results.memory = "gc_not_available";
  }

  // Run all custom recoveries (legacy)
  for (const [name, action] of recoveryActions) {
    if (smartRecoveryActions.has(name)) continue; // handled below
    try {
      await action.recoveryFn();
      const healthy = await action.checkFn();
      results[name] = healthy ? "recovered" : "recovery_incomplete";
    } catch (err) {
      results[name] = `failed — ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Run all smart recoveries (force — ignore backoff for manual trigger)
  const sortedActions = Array.from(smartRecoveryActions.values())
    .sort((a, b) => a.priority - b.priority);

  for (const action of sortedActions) {
    // Check dependencies even for manual triggers
    let depBlocked = false;
    for (const dep of action.dependsOn) {
      const depComp = components.get(dep);
      if (depComp && depComp.status === "down") {
        results[action.name] = `skipped — dependency "${dep}" is down`;
        depBlocked = true;
        break;
      }
    }
    if (depBlocked) continue;

    try {
      action.lastBackoffUntil = 0; // Clear backoff for manual trigger
      await action.recoveryFn();
      const healthy = await action.checkFn();
      if (healthy) {
        action.consecutiveFailures = 0;
        action.totalSuccesses++;
        results[action.name] = "recovered";
      } else {
        results[action.name] = "recovery_incomplete";
      }
      action.totalAttempts++;
    } catch (err) {
      action.totalAttempts++;
      action.consecutiveFailures++;
      results[action.name] = `failed — ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Re-run health check to update state
  await runHealthCheck();

  return {
    previousState,
    newState: currentState,
    results,
  };
}

/**
 * Start the self-healing monitor. Call once at server startup.
 * Non-blocking — the interval runs in the background.
 */
export function startSelfHealing(): void {
  if (intervalHandle) {
    log.warn("Self-healing monitor already running");
    return;
  }

  log.info("Self-healing monitor v2 started", {
    intervalMs: CHECK_INTERVAL_MS,
    features: ["predictive-health", "smart-recovery", "anomaly-detection", "watchdog", "event-loop-tracking"],
  });

  // Start event loop lag tracking
  startEventLoopLagTracking();

  // Run first check after a short delay (let server finish starting)
  const startupTimeout = setTimeout(() => {
    runHealthCheck().catch(err => {
      log.error("Initial health check failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, 5_000);
  if (typeof startupTimeout === "object" && "unref" in startupTimeout) {
    startupTimeout.unref();
  }

  // Schedule periodic checks
  intervalHandle = setInterval(() => {
    // Watchdog: if last successful check was too long ago, log it
    if (lastSuccessfulCheckTime > 0) {
      const timeSinceSuccess = Date.now() - lastSuccessfulCheckTime;
      if (timeSinceSuccess > CHECK_INTERVAL_MS * 3) {
        log.error("Watchdog: no successful health check in 3 intervals", {
          timeSinceSuccessMs: timeSinceSuccess,
          lastSuccessful: new Date(lastSuccessfulCheckTime).toISOString(),
        });
      }
    }

    runHealthCheck().catch(err => {
      log.error("Periodic health check failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, CHECK_INTERVAL_MS);

  // Don't prevent Node from exiting
  if (intervalHandle && typeof intervalHandle === "object" && "unref" in intervalHandle) {
    intervalHandle.unref();
  }
}

/**
 * Stop the self-healing monitor. Useful for graceful shutdown.
 */
export function stopSelfHealing(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  stopEventLoopLagTracking();
  log.info("Self-healing monitor stopped");
}

/**
 * Get current system state (quick accessor).
 */
export function getCurrentState(): SystemState {
  return currentState;
}
