/**
 * withTimeout · bound any promise by a wall-clock deadline.
 *
 * Races `promise` against a timer. If the timer wins, the returned
 * promise REJECTS with a TimeoutError so the caller's existing
 * try/catch can fall back — it does NOT cancel the underlying work
 * (that keeps running detached; use an AbortSignal for true cancel).
 *
 * Why this exists: several pre-stream steps in the chat route await
 * an LLM/network call whose only bound was the per-provider 45s
 * timeout. A stalled provider chain (45s × N tiers) produced the
 * "Nick is stuck" 90s zero-byte hang. Cheap, non-critical decisions
 * (intent + specialist classification) must fail FAST to a safe
 * default rather than block the whole turn.
 */

export class TimeoutError extends Error {
  constructor(ms: number, label?: string) {
    super(`${label ?? "operation"} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label?: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms, label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
