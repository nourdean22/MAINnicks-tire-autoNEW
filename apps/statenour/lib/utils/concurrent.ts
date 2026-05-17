/**
 * Concurrent helpers · v10.0.201
 *
 * Promotes the sliding-window concurrency pattern shipped in
 * v10.0.195's mega-cron fix to a reusable utility. Anywhere we
 * fan out N async ops that share a rate-limited backend (AI
 * providers, external APIs, DB pools) should use this instead
 * of `Promise.all(items.map(fn))`.
 *
 * The mega-cron probe found `Promise.all` against 30+ jobs caused
 * a thundering herd against the 4 AI providers; rate limits tripped
 * and ai-memory dropped to 50% emergency-sentinel rate. The fix is
 * exactly this pattern with concurrency=6.
 *
 * Idiot Index check (Elon): 0 deps. Native JS. ~25 lines for the
 * full helper.
 */

/**
 * Run `fn` over each item with at most `concurrency` in flight.
 * Order of `results` matches the order of `items`. Failures DO NOT
 * abort the run — the worker that hit the failure stops on that
 * item, but other workers keep pulling. The error is swallowed and
 * the result slot stays undefined; if you need per-item error
 * surfacing, return `{ ok, value, error }` from `fn`.
 *
 * Why sliding window vs chunked batches: faster items free their
 * slot immediately. Chunking forces the whole batch to wait on
 * the slowest member.
 */
export async function withConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        // Allow caller to model errors via the return type.
        // Throwing here would abort the worker but not the whole
        // run; better to record an undefined slot than to silently
        // shut down a worker.
        results[i] = undefined as R;
        // Re-export the error via a side channel? For now: rely on
        // caller-level instrumentation. If a future caller needs
        // per-item errors, return an Either<E, R> from `fn`.
        void err;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Resolve `fn` against each item with concurrency, but capture per-
 * item success/failure as a discriminated union. Useful when the
 * caller wants to count failures without losing successes.
 */
export type SettledResult<R> =
  | { ok: true; value: R }
  | { ok: false; error: Error };

export async function withConcurrencySettled<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<SettledResult<R>[]> {
  return withConcurrency(items, async (item, i) => {
    try {
      return { ok: true, value: await fn(item, i) } as SettledResult<R>;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err : new Error(String(err)),
      } as SettledResult<R>;
    }
  }, concurrency);
}
