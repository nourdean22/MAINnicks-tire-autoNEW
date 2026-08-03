/**
 * Runtime-safe replacement for the ES2024 `Map.groupBy` static method.
 *
 * HISTORY: prod ran on Node 20, whose V8 predates `Map.groupBy` (Node 21 / V8
 * 12.3). Calling it there threw "Map.groupBy is not a function" at runtime — 19
 * times in 48h from the persona scorer + reasoning telemetry (#1009).
 *
 * Prod moved to Node 24 on 2026-08-03, so `Map.groupBy` IS now available. This
 * helper is retained deliberately, not by oversight: it is the rollback safety
 * net. If the runtime is ever pinned back to 20, code calling `Map.groupBy`
 * directly starts throwing again at RUNTIME, with nothing at build time to warn
 * you. Prefer this helper; do not migrate call sites back to the native static.
 *
 * Same semantics as `Map.groupBy`: iterates `items` in order, calls `keyFn` for
 * each element, and returns a `Map<K, T[]>` whose keys and buckets preserve
 * insertion order.
 */
export function mapGroupBy<T, K>(
  items: Iterable<T>,
  keyFn: (item: T, index: number) => K,
): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  let index = 0;
  for (const item of items) {
    const key = keyFn(item, index++);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}
