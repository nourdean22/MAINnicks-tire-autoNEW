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
/**
 * Race `promise` against a timer. Reject with a `TimeoutError`-like
 * Error if the timer fires first. The timer is always cleared, even
 * on success — prevents the leak that bit the pre-fix nickstire
 * vendorHealth helper.
 */
export declare function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T>;
/**
 * Race `promise` against a timer. Resolve to `fallback` if the timer
 * fires first. Use this when downstream code can degrade gracefully.
 */
export declare function withTimeoutOrFallback<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T>;
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
export declare function fetchWithTimeout(url: string | URL, init?: RequestInit, ms?: number): Promise<Response>;
//# sourceMappingURL=with-timeout.d.ts.map