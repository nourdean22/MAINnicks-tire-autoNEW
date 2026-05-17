/**
 * Neon quota-aware Prisma wrapper (Karpathy Mode Circuit Breaker)
 *
 * When Neon's compute quota is exhausted, Prisma throws. Instead of a
 * naive 60s hard-dropout, this implements a smart "half-open" circuit.
 * If the quota is blown, we drop 95% of queries to protect the app,
 * but let 5% through as "probes". If a probe succeeds, the circuit
 * instantly closes and the app recovers immediately, rather than waiting.
 */

export const QUOTA_ERROR_PATTERNS = [
  "exceeded the compute time quota",
  "Your account or project has exceeded",
  "Upgrade your plan",
];

let lastQuotaErrorAt: number = 0;
const QUOTA_STICKY_MS = 60_000;
const PROBE_RATE = 0.05; // 5% of queries are allowed to probe the DB when "offline"

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
    return fallback;
  }
  
  try {
    const result = await fn();
    
    // If we succeeded and were previously in the penalty box, recover instantly.
    if (lastQuotaErrorAt !== 0) {
      if (opts.label && process.env.NODE_ENV !== "production") {
        console.log(`[safe-prisma] 🟢 ${opts.label} · probe succeeded! Circuit closed.`);
      }
      markQuotaRecovered();
    }
    
    return result;
  } catch (err) {
    if (isQuotaError(err)) {
      markQuotaExhausted();
      if (opts.label && process.env.NODE_ENV !== "production") {
        console.warn(`[safe-prisma] 🔴 ${opts.label} · quota exhausted · circuit opened`);
      }
      return fallback;
    }
    throw err;
  }
}
