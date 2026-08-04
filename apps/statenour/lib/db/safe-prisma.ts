/**
 * Neon quota-aware Prisma wrapper (Karpathy Mode Circuit Breaker)
 *
 * When Neon's compute quota is exhausted, Prisma throws. Instead of a
 * naive 60s hard-dropout, this implements a smart "half-open" circuit.
 * If the quota is blown, we drop 95% of queries to protect the app,
 * but let 5% through as "probes". If a probe succeeds, the circuit
 * instantly closes and the app recovers immediately, rather than waiting.
 */

import { logger } from "@/lib/logger";

export const QUOTA_ERROR_PATTERNS = [
  "exceeded the compute time quota",
  "Your account or project has exceeded",
  "Upgrade your plan",
];

let lastQuotaErrorAt: number = 0;
const QUOTA_STICKY_MS = 60_000;
const PROBE_RATE = 0.05; // 5% of queries are allowed to probe the DB when "offline"

const log = logger.withSurface("db/quota-circuit");

/**
 * Which labels have already reported a skip in the CURRENT open window.
 *
 * Keyed on label, valued with the `lastQuotaErrorAt` of the window that was
 * reported. A new window has a new timestamp, so it reports again — but the
 * ~46 call sites do not each emit a line on every one of the 95% of reads this
 * drops for 60s. Without the dedupe, making this visible would replace silence
 * with a flood, which is its own way of being unreadable.
 */
const skipReportedForWindow = new Map<string, number>();

/** Determine if we should block this query or allow it (either healthy or a probe) */
export function isQuotaExhausted(): boolean {
  const timeSinceError = Date.now() - lastQuotaErrorAt;
  
  // Circuit is CLOSED (healthy)
  if (timeSinceError > QUOTA_STICKY_MS) {
    return false;
  }
  
  // Circuit is HALF-OPEN (probing)
  if (Math.random() < PROBE_RATE) {
    return false; // Let it through to test the waters
  }
  
  // Circuit is OPEN (exhausted)
  return true;
}

/** Parse an error message for the Neon quota signature. */
export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return QUOTA_ERROR_PATTERNS.some((p) => msg.includes(p));
}

/** Record that we saw a quota error — opens the circuit. */
export function markQuotaExhausted(): void {
  lastQuotaErrorAt = Date.now();
}

/** Record a successful query — instantly closes the circuit. */
export function markQuotaRecovered(): void {
  lastQuotaErrorAt = 0;
  // The next open window is a NEW incident and must report again.
  skipReportedForWindow.clear();
}

/**
 * Run a Prisma query with a probabilistic half-open circuit breaker.
 * Returns the fallback if the circuit is OPEN, otherwise runs the query.
 * If a query succeeds while in the 60s window, the circuit instantly recovers.
 */
export async function safeQuery<T>(
  fn: () => Promise<T>,
  fallback: T,
  opts: { label?: string; retries?: number } = {},
): Promise<T> {
  if (isQuotaExhausted()) {
    // THE SKIP PATH WAS ENTIRELY SILENT. This is the branch that hands a
    // caller its zero/empty fallback without ever asking the database, and it
    // is what the home header, the coverage page and the health digest were
    // rendering as "calm", "all 8 categories are clean" and "all other probes
    // clean". With no line here and both lines below gated off in production,
    // there was no way to answer "has this actually fired?" — so the blast
    // radius of every one of those surfaces was unmeasurable.
    if (opts.label && skipReportedForWindow.get(opts.label) !== lastQuotaErrorAt) {
      skipReportedForWindow.set(opts.label, lastQuotaErrorAt);
      log.warn("quota circuit OPEN — query skipped, caller served its fallback", {
        label: opts.label,
        windowOpenedAt: new Date(lastQuotaErrorAt).toISOString(),
        note: "the value this caller returns is fabricated, not measured",
      });
    }
    return fallback;
  }

  try {
    const result = await fn();

    // If we succeeded and were previously in the penalty box, recover instantly.
    if (lastQuotaErrorAt !== 0) {
      if (opts.label) {
        log.info("quota circuit CLOSED — probe succeeded", { label: opts.label });
      }
      markQuotaRecovered();
    }

    return result;
  } catch (err) {
    if (isQuotaError(err)) {
      markQuotaExhausted();
      if (opts.label) {
        log.warn("quota circuit OPENED — Neon quota exhausted", { label: opts.label });
      }
      return fallback;
    }
    throw err;
  }
}
