/**
 * Wall-clock bounds for promises and HTTP fetches.
 *
 * Consolidates three duplicate implementations that previously lived in:
 *   - apps/nickstire/server/services/vendorHealth.ts:151
 *   - apps/statenour/lib/ai/multi-search.ts:92
 *   - apps/statenour/lib/services/chat/brain-context.ts:112
 *
 * Extracted as part of Tier-2-E follow-up (2026-05-19) after the
 * vibe-code-auditor pass surfaced 36+ untimed external fetches across
 * statenour integrations — same class of risk that just produced 3
 * production-hang fixes in wave-181.90 on the nickstire side.
 *
 * Three exported APIs:
 *
 *  1. `withTimeout(promise, ms, label?)` · reject the wrapped promise
 *     with a TimeoutError after `ms` milliseconds. Use when timeout
 *     should propagate as an error (the existing try/catch handles it).
 *
 *  2. `withTimeoutOrFallback(promise, ms, fallback)` · resolve to
 *     `fallback` instead of rejecting. Use when downstream code can
 *     continue with a partial / empty value (e.g. brain-context.ts
 *     blocks that always stream the chat regardless).
 *
 *  3. `fetchWithTimeout(url, init?, ms?)` · drop-in replacement for
 *     `fetch()` that uses `AbortSignal.timeout(ms)` so the underlying
 *     network request is actually cancelled (frees the socket · unlike
 *     Promise.race which just stops awaiting the response).
 *
 * Both apps target Node 20+ which supports AbortSignal.timeout natively.
 */

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Race `promise` against a timer. Reject with a `TimeoutError`-like
 * Error if the timer fires first. The timer is always cleared, even
 * on success — prevents the leak that bit the pre-fix nickstire
 * vendorHealth helper.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label?: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      const msg = label
        ? `${label} timed out after ${ms}ms`
        : `Timed out after ${ms}ms`;
      reject(new Error(msg));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Race `promise` against a timer. Resolve to `fallback` if the timer
 * fires first. Use this when downstream code can degrade gracefully.
 */
export function withTimeoutOrFallback<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout])
    .catch(() => fallback)
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}

/**
 * Wrap `fetch()` with an AbortSignal that cancels the underlying
 * network request after `ms` milliseconds. Unlike Promise.race,
 * this actually frees the socket — important when the upstream
 * is slow-loris-style (slow byte stream).
 *
 * Default 15s. Caller-supplied AbortSignal in `init.signal` is
 * respected via AbortSignal.any() so caller cancellation still
 * works (e.g. React StrictMode / route teardown).
 */
export function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  ms: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(ms);
  // Compose with caller signal if provided. AbortSignal.any was added
  // in Node 20.3+ · both apps run Node 20-alpine which includes it.
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(url, { ...init, signal });
}
