/**
 * Self-Healing Monitor — Periodic health checks with auto-recovery
 *
 * Runs every 60 seconds to check:
 * - Database connectivity (auto-reconnect on failure)
 * - AI gateway circuit breaker state
 * - Memory usage (GC trigger + warnings at 90%)
 *
 * State machine: healthy → degraded → critical
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

// ─── State ──────────────────────────────────────────

let currentState: SystemState = "healthy";
let lastCheckTimestamp = 0;
let checkCount = 0;

const components = new Map<string, ComponentHealth>();
const recoveryActions = new Map<string, RecoveryAction>();
const stateHistory: StateTransition[] = [];
const MAX_HISTORY = 50;
const CHECK_INTERVAL_MS = 60_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

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
  const heapPercent = heapTotalMB > 0 ? Math.round((heapUsedMB / heapTotalMB) * 100) : 0;

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
  } else if (heapPercent >= 90) {
    comp.status = "degraded";
    comp.error = `High memory usage: ${heapPercent}% (${heapUsedMB}MB/${heapTotalMB}MB heap, ${rssMB}MB RSS)`;
    log.warn("Memory usage elevated at " + heapPercent + "%", {
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

// ─── Run all custom recovery actions ────────────────

async function runCustomRecoveries(): Promise<void> {
  for (const [name, action] of recoveryActions) {
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
  checkCount++;
  const start = Date.now();

  try {
    // Run all checks concurrently (non-blocking to each other)
    await Promise.allSettled([
      checkDatabase(),
      checkAIGateway(),
      Promise.resolve(checkMemory()),
      runCustomRecoveries(),
    ]);

    const newState = computeOverallState();
    const reasons: string[] = [];
    for (const comp of components.values()) {
      if (comp.status !== "ok") {
        reasons.push(`${comp.name}: ${comp.status}${comp.error ? ` (${comp.error})` : ""}`);
      }
    }

    transitionState(newState, reasons.length > 0 ? reasons.join("; ") : "All components healthy");

    lastCheckTimestamp = Date.now();
    const elapsed = Date.now() - start;

    if (elapsed > 5000) {
      log.warn("Health check took longer than expected", { elapsedMs: elapsed });
    }
  } catch (err) {
    log.error("Health check cycle failed", {
      error: err instanceof Error ? err.message : String(err),
    });
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
 * Returns full system health state — suitable for API responses.
 */
export function getSystemHealth(): {
  state: SystemState;
  uptime: number;
  lastCheck: string | null;
  checkCount: number;
  components: Record<string, {
    status: string;
    lastCheck: string | null;
    error: string | null;
    recoveryCount: number;
    lastRecoveryAttempt: string | null;
  }>;
  stateHistory: Array<{
    from: string;
    to: string;
    timestamp: string;
    reason: string;
  }>;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    heapPercent: number;
  };
} {
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

  return {
    state: currentState,
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
      heapPercent: heapTotalMB > 0 ? Math.round((heapUsedMB / heapTotalMB) * 100) : 0,
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

  // Run all custom recoveries
  for (const [name, action] of recoveryActions) {
    try {
      await action.recoveryFn();
      const healthy = await action.checkFn();
      results[name] = healthy ? "recovered" : "recovery_incomplete";
    } catch (err) {
      results[name] = `failed — ${err instanceof Error ? err.message : String(err)}`;
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

  log.info("Self-healing monitor started", { intervalMs: CHECK_INTERVAL_MS });

  // Run first check after a short delay (let server finish starting)
  setTimeout(() => {
    runHealthCheck().catch(err => {
      log.error("Initial health check failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, 5_000);

  // Schedule periodic checks
  intervalHandle = setInterval(() => {
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
    log.info("Self-healing monitor stopped");
  }
}

/**
 * Get current system state (quick accessor).
 */
export function getCurrentState(): SystemState {
  return currentState;
}
