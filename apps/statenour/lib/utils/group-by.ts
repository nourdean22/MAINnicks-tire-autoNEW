/**
 * Runtime-safe replacement for the ES2024 `Map.groupBy` static method.
 *
 * Prod runs on Node 20 (`node:20-alpine`, see apps/statenour/Dockerfile), whose
 * V8 predates `Map.groupBy` (added in Node 21 / V8 12.3). Calling `Map.groupBy`
 * there throws "Map.groupBy is not a function" at runtime — it fired 19 times in
 * 48h from the persona scorer + reasoning telemetry before this helper existed.
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
