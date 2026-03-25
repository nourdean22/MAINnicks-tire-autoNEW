/**
 * Safe Call Utility — Wraps async functions with error boundaries
 * Prevents unhandled exceptions from crashing the Express process.
 * Returns a default value on failure instead of throwing.
 */

import { createLogger } from "./logger";

const log = createLogger("safe-call");

/**
 * Execute an async function safely. Returns defaultValue on any error.
 * Logs the error but never throws.
 */
export async function safeCall<T>(
  label: string,
  fn: () => Promise<T>,
  defaultValue: T
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[${label}] Failed safely`, { error: message });
    return defaultValue;
  }
}

/**
 * Fire-and-forget — runs an async function without awaiting or throwing.
 * Used for non-critical side effects (analytics, logging, notifications).
 */
export function fireAndForget(label: string, fn: () => Promise<any>): void {
  fn().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`[${label}] Background task failed`, { error: message });
  });
}
