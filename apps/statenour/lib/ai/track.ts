/**
 * AI generation tracking — persists every AI call to the database
 * for cost visibility, debugging, and usage analytics.
 *
 * Now includes: cost estimation, daily budget tracking, per-feature analytics.
 */

import { prisma } from "@/lib/prisma";

// Cost per 1M tokens (approximate, updated Apr 28 2026).
// Pricing reference: Venice Pro (model card), Ollama Cloud Pro flat $20/mo
// (zero per-token), OpenAI/Anthropic public list prices.
//
// Ollama is intentionally listed at $0.00 — the $20 flat fee is amortized
// across the month via a separate dashboard tile, not per-call. This keeps
// per-feature breakdowns honest (a coach-goal call to qwen3-vl really IS
// "free" at the margin once the subscription is paid).
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // ── Venice (current Apr 2026 model list) ─────────────────────────────
  "venice-uncensored": { input: 0.35, output: 0.40 },          // stock fast model
  "olafangensan-glm-4.7": { input: 0.60, output: 0.80 },       // GLM-4.7 heretic (creative)
  "glm-4.7": { input: 0.60, output: 0.80 },                    // alias
  "heretic": { input: 0.60, output: 0.80 },                    // alias
  "llama-3.3-70b": { input: 0.35, output: 0.40 },              // legacy entry
  "deepseek-r1-671b": { input: 0.90, output: 2.50 },           // legacy entry
  "dolphin-2.9.3-mistral-7b": { input: 0.07, output: 0.07 },   // legacy entry
  // ── Ollama Cloud Pro — $20/mo flat, $0 per-call ──────────────────────
  "qwen3-vl": { input: 0, output: 0 },
  "qwen3-vl:235b-instruct": { input: 0, output: 0 },
  "qwen3-coder-next": { input: 0, output: 0 },
  "deepseek-v4-flash": { input: 0, output: 0 },
  "deepseek-v4-pro": { input: 0, output: 0 },
  "kimi-k2.6": { input: 0, output: 0 },
  // ── OpenAI ───────────────────────────────────────────────────────────
  "gpt-4o": { input: 2.50, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-5": { input: 5.0, output: 20.0 },
  "gpt-oss": { input: 0, output: 0 },
  // ── Anthropic ────────────────────────────────────────────────────────
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
  "claude-haiku-3.5": { input: 0.80, output: 4.0 },
  "claude-opus-4": { input: 15.0, output: 75.0 },
  // ── Image models (Venice) — flat per-image, mapped to per-call estimate
  // Per-image is recorded on the prompt-tokens side as a synthetic "image
  // ticket" so the cost dashboard can compare image vs chat spend without
  // a separate schema. Keep in sync with venice-image.ts model list.
  "recraft-v4": { input: 50_000, output: 0 },        // $0.05/img → 50k synthetic tokens
  "z-image-turbo": { input: 10_000, output: 0 },     // $0.01/img
  "flux-2-pro": { input: 40_000, output: 0 },        // $0.04/img
  "seedream-v4": { input: 50_000, output: 0 },       // $0.05/img
  "nano-banana-2": { input: 40_000, output: 0 },     // $0.04/img
  "qwen-image": { input: 10_000, output: 0 },        // $0.01/img
  // Default for unknown models
  default: { input: 0.50, output: 1.50 },
};

function estimateCostCents(model: string, promptTokens?: number, outputTokens?: number): number {
  const modelKey = Object.keys(MODEL_COSTS).find(k => model.toLowerCase().includes(k.toLowerCase()));
  const costs = MODEL_COSTS[modelKey || "default"] || MODEL_COSTS.default;
  const inputCost = ((promptTokens || 0) / 1_000_000) * costs.input;
  const outputCost = ((outputTokens || 0) / 1_000_000) * costs.output;
  return Math.round((inputCost + outputCost) * 100); // in cents
}

/**
 * Tracks an AI generation in the database with cost estimation.
 *
 * v10.0.529.106 · Wave 59 · added `conversationId` parameter to unlock
 * per-conversation cost attribution. Pre-Wave-59 cost-slo.ts had to
 * fall back to grouping by `feature` name (which lost the breakdown).
 * Now optional · non-chat callers (cron · brain · social) can omit it.
 */
export async function trackGeneration(data: {
  feature: string;
  model: string;
  promptTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  status?: string;
  conversationId?: string;
}) {
  const costCents = estimateCostCents(data.model, data.promptTokens, data.outputTokens);

  return prisma.aiGeneration.create({
    data: {
      feature: data.feature,
      model: data.model,
      promptTokens: data.promptTokens,
      outputTokens: data.outputTokens,
      durationMs: data.durationMs,
      status: data.status ?? "complete",
      costCents: costCents,
      conversationId: data.conversationId ?? null,
    },
  }).catch((err) => {
    // Non-critical — don't break AI responses if tracking fails
    console.error("[track] Failed to record generation:", err?.message);
  });
}

/**
 * Per-model latency percentiles + reliability over a window. Reads
 * AiGeneration via raw SQL (Postgres `percentile_cont`) so we don't
 * sort 100K+ rows in JS land.
 *
 * Returns one row per model with p50/p95/p99 ms, error rate, call count.
 * Used by /system/costs to decide which model is the laggard before the
 * user feels it.
 *
 * Apr 28 · added during BATCH 2 (latency-tracker).
 */
export interface ModelLatencyRow {
  model: string;
  calls: number;
  errors: number;
  errorRate: number;        // 0-1
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  maxMs: number;
  totalCostCents: number;
}

export async function getModelLatencyStats(
  daysBack: number = 7,
): Promise<ModelLatencyRow[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  // percentile_cont gives us proper interpolated percentiles. Cast
  // duration_ms to numeric so the percentile aggregate accepts it
  // even when nulls are present (filtered out by WHERE clause).
  const rows = await prisma.$queryRawUnsafe<Array<{
    model: string;
    calls: bigint;
    errors: bigint;
    p50_ms: number | null;
    p95_ms: number | null;
    p99_ms: number | null;
    avg_ms: number | null;
    max_ms: number | null;
    total_cost: bigint | null;
  }>>(
    `
    SELECT
      model,
      COUNT(*)::bigint AS calls,
      SUM(CASE WHEN status <> 'complete' THEN 1 ELSE 0 END)::bigint AS errors,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms::numeric) AS p50_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms::numeric) AS p95_ms,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms::numeric) AS p99_ms,
      AVG(duration_ms::numeric) AS avg_ms,
      MAX(duration_ms) AS max_ms,
      SUM(cost_cents)::bigint AS total_cost
    FROM ai_generations
    WHERE created_at >= $1
      AND duration_ms IS NOT NULL
    GROUP BY model
    ORDER BY calls DESC
    LIMIT 50
    `,
    since,
  ).catch((err) => {
    console.error("[track:getModelLatencyStats] query failed:", err?.message);
    return [];
  });

  return rows.map((r) => {
    const calls = Number(r.calls);
    const errors = Number(r.errors);
    return {
      model: r.model,
      calls,
      errors,
      errorRate: calls > 0 ? errors / calls : 0,
      p50Ms: Math.round(r.p50_ms ?? 0),
      p95Ms: Math.round(r.p95_ms ?? 0),
      p99Ms: Math.round(r.p99_ms ?? 0),
      avgMs: Math.round(r.avg_ms ?? 0),
      maxMs: Math.round(r.max_ms ?? 0),
      totalCostCents: Number(r.total_cost ?? 0),
    };
  });
}

/**
 * v7 · BATCH 2C · Apr 28 — Per-model daily latency buckets for sparklines.
 * Returns last N days of avg p50 + p95 per model. Used by /system/costs
 * to render a tiny trend curve next to each model's latency row.
 */
export interface ModelLatencyTrendRow {
  model: string;
  buckets: Array<{ day: string; calls: number; p50Ms: number; p95Ms: number }>;
}

export async function getModelLatencyTrend(daysBack: number = 7): Promise<ModelLatencyTrendRow[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRawUnsafe<Array<{
    model: string;
    day: Date;
    calls: bigint;
    p50_ms: number | null;
    p95_ms: number | null;
  }>>(
    `
    SELECT
      model,
      DATE_TRUNC('day', created_at) AS day,
      COUNT(*)::bigint AS calls,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms::numeric) AS p50_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms::numeric) AS p95_ms
    FROM ai_generations
    WHERE created_at >= $1
      AND duration_ms IS NOT NULL
    GROUP BY model, DATE_TRUNC('day', created_at)
    ORDER BY model, day ASC
    `,
    since,
  ).catch((err) => {
    console.error("[track:getModelLatencyTrend]:", err?.message);
    return [];
  });

  const grouped = new Map<string, ModelLatencyTrendRow["buckets"]>();
  for (const r of rows) {
    if (!grouped.has(r.model)) grouped.set(r.model, []);
    grouped.get(r.model)!.push({
      day: r.day.toISOString().split("T")[0],
      calls: Number(r.calls),
      p50Ms: Math.round(r.p50_ms ?? 0),
      p95Ms: Math.round(r.p95_ms ?? 0),
    });
  }
  return Array.from(grouped.entries()).map(([model, buckets]) => ({ model, buckets }));
}

/**
 * Get AI usage stats for a time period.
 */
export async function getAiUsageStats(daysBack: number = 7) {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  // 2026-05-27 · the previous bare `.catch(() => [])` meant the
  // /system/costs per-feature breakdown silently rendered $0 across
  // the board when the AiGeneration table was unreachable (schema
  // drift, replica lag, etc.) — operator had no way to tell if cost
  // tracking itself was broken vs spend was genuinely zero. Log the
  // failure so the next operator hitting "why does costs show zero"
  // can grep prod logs.
  const [totalGenerations, byFeature, totalCost] = await Promise.all([
    prisma.aiGeneration.count({ where: { createdAt: { gte: since } } }),
    prisma.aiGeneration.groupBy({
      by: ["feature"],
      where: { createdAt: { gte: since } },
      _count: { id: true },
      _sum: { promptTokens: true, outputTokens: true, costCents: true },
    }).catch((err) => {
      console.warn(
        "[ai/track] aiGeneration.groupBy failed:",
        err instanceof Error ? err.message : err,
      );
      return [];
    }),
    prisma.aiGeneration.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { costCents: true, promptTokens: true, outputTokens: true },
    }).catch((err) => {
      console.warn(
        "[ai/track] aiGeneration.aggregate failed:",
        err instanceof Error ? err.message : err,
      );
      return { _sum: { costCents: 0, promptTokens: 0, outputTokens: 0 } };
    }),
  ]);

  return {
    totalGenerations,
    totalCostCents: totalCost._sum.costCents || 0,
    totalPromptTokens: totalCost._sum.promptTokens || 0,
    totalOutputTokens: totalCost._sum.outputTokens || 0,
    byFeature: byFeature.map((f: any) => ({
      feature: f.feature,
      count: f._count.id,
      costCents: f._sum?.costCents || 0,
      promptTokens: f._sum?.promptTokens || 0,
      outputTokens: f._sum?.outputTokens || 0,
    })),
  };
}
