/**
 * Evolution A/B · Tier A · wave-181.x
 *
 * Minimal deterministic variant-assignment helper. Same visitorKey
 * always gets the same variant for the same experimentSlug · so
 * conversion attribution is stable across sessions and pageviews.
 *
 * Philosophy · the heaviest A/B platforms (Optimizely · LaunchDarkly
 * · GrowthBook) all do ONE thing well · deterministic bucketing.
 * Everything else is dashboards on top. This file gives nickstire
 * the bucketing primitive without the platform tax · downstream
 * conversion tracking uses the existing chat_analytics +
 * search_performance + invoices tables.
 *
 * Usage
 *   const variant = chooseVariant("hero-cta-2026-05", visitorKey,
 *     ["call-now-bold", "call-now-quiet"]);
 *   if (variant === "call-now-bold") { ... }
 *   // Track the variant in event analytics so post-hoc lift
 *   // analysis can group by variant.
 *
 * Statistical note · 50/50 split with deterministic hash gives
 * unbiased buckets at scale. For uneven splits (e.g. 80/20 safety),
 * use chooseVariantWeighted instead.
 *
 * Why no DB table for assignments · they're deterministic from
 * (visitorKey + experimentSlug). Recomputing on each pageview is
 * cheap and avoids a write path. If the operator wants persisted
 * assignments for later analysis, log them through the existing
 * chat_analytics or event-bus path · not a new table.
 */

import { createHash } from "crypto";

/**
 * Deterministic uniform split. Same input always returns same variant.
 * Uses MD5(visitorKey:experimentSlug) MOD variants.length for stable
 * bucketing.
 */
export function chooseVariant<T extends string>(
  experimentSlug: string,
  visitorKey: string,
  variants: readonly T[],
): T {
  if (variants.length === 0) throw new Error("variants array empty");
  if (variants.length === 1) return variants[0];
  const hash = createHash("md5")
    .update(`${experimentSlug}:${visitorKey}`)
    .digest("hex");
  // Take first 8 hex chars · interpret as unsigned 32-bit int.
  const n = parseInt(hash.slice(0, 8), 16);
  return variants[n % variants.length];
}

/**
 * Weighted variant selection. Pass [["a", 0.8], ["b", 0.2]] for an
 * 80/20 split. Deterministic for the same (slug, visitorKey).
 */
export function chooseVariantWeighted<T extends string>(
  experimentSlug: string,
  visitorKey: string,
  weighted: Array<[T, number]>,
): T {
  if (weighted.length === 0) throw new Error("weighted array empty");
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) throw new Error("weights must sum to > 0");
  const hash = createHash("md5")
    .update(`${experimentSlug}:${visitorKey}`)
    .digest("hex");
  const n = parseInt(hash.slice(0, 8), 16) / 0xffffffff; // 0..1
  const target = n * total;
  let acc = 0;
  for (const [variant, w] of weighted) {
    acc += w;
    if (target <= acc) return variant;
  }
  return weighted[weighted.length - 1][0];
}

/**
 * For operator-side reports · compute variant bucket distribution for
 * a population of visitor keys. Sanity-checks that an experiment is
 * splitting traffic the way you expect.
 */
export function distributionFor<T extends string>(
  experimentSlug: string,
  visitorKeys: string[],
  variants: readonly T[],
): Record<T, number> {
  const counts = Object.fromEntries(variants.map((v) => [v, 0])) as Record<T, number>;
  for (const k of visitorKeys) {
    const v = chooseVariant(experimentSlug, k, variants);
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}
