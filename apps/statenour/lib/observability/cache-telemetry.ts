/**
 * Prompt-cache telemetry · v10.0.385
 *
 * Per /prompt-caching skill follow-up · v10.0.362 enabled Anthropic
 * prompt caching (cacheControl: ephemeral on system prompt). The AI
 * SDK reports usage tokens in result.providerMetadata.anthropic but
 * we never tracked them. This module captures cache hit/miss counts
 * + total tokens saved per session.
 *
 * RESETS on Vercel cold start (acceptable · we sample, not audit).
 *
 * COSTS WE'RE TRACKING
 *   · cacheCreationInputTokens · paid full price (1.25x base)
 *   · cacheReadInputTokens     · 90% discount (0.10x base)
 *   · regularInputTokens       · paid full price (1x base)
 *
 * EFFECTIVE COST
 *   creation × 1.25 + read × 0.10 + regular × 1.0
 *
 * RAW BASE-PRICE COST
 *   total_input × 1.0
 *
 * SAVINGS = raw - effective
 */

interface CacheStats {
  totalCalls: number;
  totalCacheCreations: number;
  totalCacheReads: number;
  totalRegularInput: number;
  totalOutput: number;
  /** Sum of cacheCreationInputTokens · paid 1.25x */
  cacheCreationInputTokens: number;
  /** Sum of cacheReadInputTokens · paid 0.10x */
  cacheReadInputTokens: number;
  /** Sum of standard input tokens (no cache) · paid 1.0x */
  regularInputTokens: number;
  /** Sum of output tokens · paid 1.0x output rate */
  outputTokens: number;
  /** Per-provider counts */
  byProvider: Record<string, { calls: number; cacheReads: number; cacheCreations: number }>;
}

const stats: CacheStats = {
  totalCalls: 0,
  totalCacheCreations: 0,
  totalCacheReads: 0,
  totalRegularInput: 0,
  totalOutput: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  regularInputTokens: 0,
  outputTokens: 0,
  byProvider: {},
};

interface RecordArgs {
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Anthropic-specific · from providerMetadata.anthropic */
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/**
 * Capture token usage from a single provider call. Safe to call from
 * anywhere · null/undefined fields are no-ops.
 */
export function recordCacheUsage(args: RecordArgs): void {
  stats.totalCalls++;
  const cacheCreate = args.cacheCreationInputTokens ?? 0;
  const cacheRead = args.cacheReadInputTokens ?? 0;
  const regular = Math.max(0, (args.inputTokens ?? 0) - cacheCreate - cacheRead);
  const output = args.outputTokens ?? 0;

  stats.cacheCreationInputTokens += cacheCreate;
  stats.cacheReadInputTokens += cacheRead;
  stats.regularInputTokens += regular;
  stats.outputTokens += output;

  if (cacheCreate > 0) stats.totalCacheCreations++;
  if (cacheRead > 0) stats.totalCacheReads++;
  if (regular > 0) stats.totalRegularInput++;

  if (!stats.byProvider[args.provider]) {
    stats.byProvider[args.provider] = { calls: 0, cacheReads: 0, cacheCreations: 0 };
  }
  const p = stats.byProvider[args.provider];
  p.calls++;
  if (cacheRead > 0) p.cacheReads++;
  if (cacheCreate > 0) p.cacheCreations++;
}

export interface CacheReport {
  windowCalls: number;
  cache: {
    creations: number;
    reads: number;
    hitRate: number;
  };
  tokens: {
    cacheCreation: number;
    cacheRead: number;
    regular: number;
    output: number;
    totalInput: number;
  };
  cost: {
    /** Effective cost ratio · cache creation 1.25x, cache read 0.10x, regular 1.0x */
    effectiveInputRatio: number;
    /** What input would have cost without caching (1.0x) */
    rawInputRatio: number;
    /** Savings ratio · 0.0 = no savings, 0.9 = 90% of input cost saved */
    savingsRatio: number;
  };
  byProvider: Record<string, { calls: number; cacheReads: number; cacheCreations: number; hitRate: number }>;
}

export function buildCacheReport(): CacheReport {
  const totalInputForCache = stats.cacheCreationInputTokens + stats.cacheReadInputTokens + stats.regularInputTokens;
  const cacheTotalCalls = stats.totalCacheReads + stats.totalCacheCreations;
  const hitRate = cacheTotalCalls > 0 ? stats.totalCacheReads / cacheTotalCalls : 0;

  // Per Anthropic pricing model:
  // base input: 1.0
  // cache write: 1.25 (1x + 25% premium)
  // cache read: 0.10 (90% discount)
  const effectiveCost =
    stats.cacheCreationInputTokens * 1.25 +
    stats.cacheReadInputTokens * 0.10 +
    stats.regularInputTokens * 1.0;
  const rawCost = totalInputForCache * 1.0;
  const savingsRatio = rawCost > 0 ? Math.max(0, 1 - effectiveCost / rawCost) : 0;

  const byProviderWithRate: CacheReport["byProvider"] = {};
  for (const [k, v] of Object.entries(stats.byProvider)) {
    const cacheCalls = v.cacheReads + v.cacheCreations;
    byProviderWithRate[k] = {
      ...v,
      hitRate: cacheCalls > 0 ? v.cacheReads / cacheCalls : 0,
    };
  }

  return {
    windowCalls: stats.totalCalls,
    cache: {
      creations: stats.totalCacheCreations,
      reads: stats.totalCacheReads,
      hitRate: Math.round(hitRate * 1000) / 1000,
    },
    tokens: {
      cacheCreation: stats.cacheCreationInputTokens,
      cacheRead: stats.cacheReadInputTokens,
      regular: stats.regularInputTokens,
      output: stats.outputTokens,
      totalInput: totalInputForCache,
    },
    cost: {
      effectiveInputRatio: Math.round(effectiveCost * 100) / 100,
      rawInputRatio: Math.round(rawCost * 100) / 100,
      savingsRatio: Math.round(savingsRatio * 1000) / 1000,
    },
    byProvider: byProviderWithRate,
  };
}

/** For tests · clear the in-process counter. */
export function _clearCacheStatsForTesting(): void {
  stats.totalCalls = 0;
  stats.totalCacheCreations = 0;
  stats.totalCacheReads = 0;
  stats.totalRegularInput = 0;
  stats.totalOutput = 0;
  stats.cacheCreationInputTokens = 0;
  stats.cacheReadInputTokens = 0;
  stats.regularInputTokens = 0;
  stats.outputTokens = 0;
  stats.byProvider = {};
}
