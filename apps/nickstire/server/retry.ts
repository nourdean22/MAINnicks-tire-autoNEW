import { createLogger } from "./lib/logger";
const log = createLogger("retry");

/**
 * Retry wrapper with exponential backoff for external API calls.
 * Used for non-critical integrations (Sheets, email, SMS, CAPI)
 * that should retry silently without blocking the main response.
 */
/**
 * A thrown error may mark itself terminal to stop the retry loop immediately.
 *
 * Retrying a deliberate policy refusal — opt-out, per-number cap, shop-wide cap,
 * human takeover — cannot succeed. It only burns backoff delay before recording
 * the same failure. Genuine transport faults stay retryable.
 */
export interface TerminalError {
  terminal?: boolean;
}

function isTerminal(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as TerminalError).terminal === true;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    label?: string;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, label = 'operation' } = options;
  let lastError: Error | unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (isTerminal(err)) break;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        log.warn(`[retry] ${label} attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
