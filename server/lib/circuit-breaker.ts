/**
 * Circuit Breaker — Generic, reusable circuit breaker for any external service call.
 *
 * States:
 *   CLOSED   → normal operation, requests pass through
 *   OPEN     → service is down, requests fail-fast without calling the service
 *   HALF_OPEN → cooldown expired, allow one probe request to test recovery
 *
 * Usage:
 *   const twilioCB = new CircuitBreaker("twilio", { failureThreshold: 5, cooldownMs: 30_000 });
 *
 *   const result = await twilioCB.call(() => sendSMS(to, body));
 *   // or with fallback:
 *   const result = await twilioCB.call(() => sendSMS(to, body), () => queueForLater(to, body));
 *
 *   // Health check
 *   const health = twilioCB.getHealth();
 */

import { createLogger } from "./logger";
import { ExternalServiceError } from "./errors";

const log = createLogger("circuit-breaker");

// ─── Types ──────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Time in ms to wait before allowing a probe request. Default: 30s */
  cooldownMs?: number;
  /** Number of consecutive successes in HALF_OPEN to close the circuit. Default: 2 */
  recoveryThreshold?: number;
  /** Timeout in ms for each call. 0 = no timeout. Default: 10s */
  timeoutMs?: number;
  /** Called when state changes. */
  onStateChange?: (from: CircuitState, to: CircuitState, service: string) => void;
}

export interface CircuitHealth {
  service: string;
  state: CircuitState;
  failures: number;
  successes: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailure: string | null;
  lastSuccess: string | null;
  openedAt: string | null;
  failureRate: number;
}

// ─── Implementation ─────────────────────────────────

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private openedAt: number | null = null;

  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly recoveryThreshold: number;
  private readonly timeoutMs: number;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState, service: string) => void;

  constructor(
    public readonly service: string,
    options: CircuitBreakerOptions = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.recoveryThreshold = options.recoveryThreshold ?? 2;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.onStateChange = options.onStateChange;
  }

  /**
   * Execute a function through the circuit breaker.
   * If the circuit is open, immediately fails (or calls fallback if provided).
   */
  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    // Check if we should allow the request
    if (this.state === "OPEN") {
      if (this.shouldProbe()) {
        this.transition("HALF_OPEN");
      } else {
        // Circuit is open — fail fast
        this.totalFailures++;
        if (fallback) {
          return fallback();
        }
        throw new ExternalServiceError(
          this.service,
          `Circuit breaker is OPEN — service unavailable (${this.consecutiveFailures} consecutive failures)`,
          { state: this.state, failures: this.consecutiveFailures }
        );
      }
    }

    // Execute the call (with optional timeout)
    try {
      const result = this.timeoutMs > 0
        ? await this.withTimeout(fn(), this.timeoutMs)
        : await fn();

      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);

      if (fallback && this.state === "OPEN") {
        return fallback();
      }
      throw err;
    }
  }

  /**
   * Get health metrics for this circuit breaker.
   */
  getHealth(): CircuitHealth {
    // Auto-check if OPEN should transition to HALF_OPEN for reporting
    const reportState = this.state === "OPEN" && this.shouldProbe() ? "HALF_OPEN" : this.state;

    return {
      service: this.service,
      state: reportState,
      failures: this.consecutiveFailures,
      successes: this.consecutiveSuccesses,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastFailure: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      lastSuccess: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null,
      failureRate: this.totalCalls > 0 ? Math.round((this.totalFailures / this.totalCalls) * 100) : 0,
    };
  }

  /**
   * Manually reset the circuit breaker to CLOSED state.
   */
  reset(): void {
    const prev = this.state;
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.openedAt = null;
    if (prev !== "CLOSED") {
      log.info(`Circuit breaker manually reset`, { service: this.service, previousState: prev });
    }
  }

  /**
   * Check if the circuit is currently allowing requests.
   */
  isAvailable(): boolean {
    if (this.state === "CLOSED") return true;
    if (this.state === "HALF_OPEN") return true;
    if (this.state === "OPEN" && this.shouldProbe()) return true;
    return false;
  }

  // ─── Internal ───────────────────────────────────

  private onSuccess(): void {
    this.lastSuccessAt = Date.now();
    this.totalSuccesses++;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;

    if (this.state === "HALF_OPEN" && this.consecutiveSuccesses >= this.recoveryThreshold) {
      this.transition("CLOSED");
    }
  }

  private onFailure(err: unknown): void {
    this.lastFailureAt = Date.now();
    this.totalFailures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    const errMsg = err instanceof Error ? err.message : String(err);

    if (this.state === "HALF_OPEN") {
      // Probe failed — back to OPEN
      this.transition("OPEN");
      log.warn(`Circuit breaker probe failed, reopening`, {
        service: this.service,
        error: errMsg.slice(0, 200),
      });
    } else if (this.state === "CLOSED" && this.consecutiveFailures >= this.failureThreshold) {
      this.transition("OPEN");
      log.error(`Circuit breaker OPENED — ${this.service} has ${this.consecutiveFailures} consecutive failures`, {
        service: this.service,
        failures: this.consecutiveFailures,
        lastError: errMsg.slice(0, 200),
      });
    }
  }

  private shouldProbe(): boolean {
    if (!this.openedAt) return false;
    return Date.now() - this.openedAt >= this.cooldownMs;
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;

    this.state = to;
    if (to === "OPEN") {
      this.openedAt = Date.now();
      this.consecutiveSuccesses = 0;
    } else if (to === "CLOSED") {
      this.openedAt = null;
      this.consecutiveFailures = 0;
      log.info(`Circuit breaker CLOSED — ${this.service} recovered`, { service: this.service });
    }

    this.onStateChange?.(from, to, this.service);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new ExternalServiceError(this.service, `Request timed out after ${ms}ms`, { timeoutMs: ms }));
      }, ms);

      promise
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

// ─── Circuit Breaker Registry ───────────────────────
// Central registry so the admin dashboard can enumerate all breakers.

const registry = new Map<string, CircuitBreaker>();

/**
 * Create a circuit breaker and register it globally.
 * If one already exists for this service name, return the existing one.
 */
export function getOrCreateBreaker(service: string, options?: CircuitBreakerOptions): CircuitBreaker {
  let cb = registry.get(service);
  if (!cb) {
    cb = new CircuitBreaker(service, options);
    registry.set(service, cb);
  }
  return cb;
}

/**
 * Get health for all registered circuit breakers.
 */
export function getAllBreakerHealth(): CircuitHealth[] {
  return Array.from(registry.values()).map(cb => cb.getHealth());
}

/**
 * Reset all circuit breakers (admin recovery action).
 */
export function resetAllBreakers(): void {
  for (const cb of registry.values()) {
    cb.reset();
  }
  log.info("All circuit breakers reset");
}
