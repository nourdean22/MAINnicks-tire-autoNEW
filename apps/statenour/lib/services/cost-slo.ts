/**
 * Cost-telemetry SLO calculator · v10.0.526 · Arc A · Feature 2
 *
 * Reads the existing `AiGeneration` table (no new schema). Computes
 * today's burn, the 24-hour forecast (linear extrapolation from
 * hours-elapsed-in-ET), and the threshold trip (forecast > budget · 1.2).
 *
 * Why this lives over AiGeneration instead of a new cost_event table:
 *   · Every provider call already goes through `trackGeneration`
 *     (lib/ai/track.ts) which writes feature + model + costCents +
 *     durationMs + createdAt. Adding a sibling table would duplicate
 *     the per-call cost stream verbatim.
 *   · A separate cost-event table would force every caller of
 *     trackGeneration to ALSO write into the new surface — predictable
 *     drift between the two.
 *   · AiGeneration is already indexed on (feature, createdAt) and
 *     (model, createdAt) and (createdAt), which covers every read this
 *     module performs.
 *
 * v10.0.529.106 · Wave 59 · `AiGeneration.conversationId` column added
 * + chat trackGeneration calls updated to populate it. The "feature
 * name approximation" workaround documented previously is now retired.
 * topConversationsByCost() groups by conversationId directly · per-
 * conversation cost attribution unlocked.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSetting } from "@/lib/services/settings";
import { startOfDayET } from "@/lib/utils/datetime";

const TZ = "America/New_York";
const DEFAULT_BUDGET_CENTS = 500; // $5/day
const BURN_THRESHOLD_MULTIPLIER = 1.2;

/**
 * The configured daily budget, in cents.
 * Reads `DAILY_AI_BUDGET_CENTS` from env. Defaults to 500 (=$5/day).
 *
 * Errors (NaN / negative / blank) fall back to the default rather than
 * crashing the calling cron — a misconfigured env should never silence
 * the SLO loop.
 */
function normalizeBudget(val: unknown, fallback: number): number {
  if (val === undefined || val === null || val === "") return fallback;
  const parsed = Number(val);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export async function resolveDailyAiBudgetCents(): Promise<number> {
  // 2026-07-11 review · budget-gate unification (operator decision:
  // "power panel works"). The Power Panel's dailyCostCapCents used to be
  // an INDEPENDENT cap enforced only in gate.ts while everything else
  // (chat 402 gate, tracedAiChat edge-wrap, cost-slo cron, dashboards)
  // read ai.dailyBudgetCents — two dials, two answers, contradictory
  // errors. Now: when the panel cap is SET (>0) it is THE daily budget
  // everywhere; when disabled (0) the ai.dailyBudgetCents setting / env
  // default remains the always-on safety net.
  try {
    const { getPowerSettings } = await import("@/lib/services/power-panel");
    const panel = await getPowerSettings();
    if (panel.dailyCostCapCents > 0) return Math.floor(panel.dailyCostCapCents);
  } catch {
    // panel read failure must never disable budget enforcement —
    // fall through to the setting/env default below.
  }
  const envFallback = normalizeBudget(process.env.DAILY_AI_BUDGET_CENTS, DEFAULT_BUDGET_CENTS);
  const stored = await getSetting<unknown>("ai.dailyBudgetCents", envFallback);
  return normalizeBudget(stored, envFallback);
}

/**
 * Returns the ET-day YYYY-MM-DD string for `at` (or now). Matches the
 * existing `morning-brief` pattern so date keys line up across crons.
 */
export function etDateKey(at: Date = new Date()): string {
  return at.toLocaleDateString("en-CA", { timeZone: TZ });
}

/**
 * Returns the UTC Date that corresponds to midnight ET for the day
 * containing `at`. The 04:00 offset works for both EDT (-04:00) and
 * EST (-05:00) for the purposes of "fetch rows since midnight" — we
 * round forward to capture the entire day; sub-hour drift between
 * EST/EDT is fine for a daily burn check (within ±1h on Nov/Mar DST
 * transition days).
 */
function todayStartUtc(at: Date = new Date()): Date {
  return startOfDayET(at);
}

/**
 * Hours elapsed in today's ET day so far. Floored at 0.5 to avoid
 * divide-by-near-zero forecast amplification at midnight (also: a 2x
 * extrapolation from 30min of data is itself noisy enough — let the
 * forecast stabilize after the first half hour).
 */
function hoursElapsedToday(at: Date = new Date()): number {
  const start = todayStartUtc(at);
  const ms = at.getTime() - start.getTime();
  const hours = ms / (60 * 60 * 1000);
  return Math.max(0.5, hours);
}

/**
 * Sum of AiGeneration cost_cents for today (ET).
 *
 * Returns the summed cents (0 when the table is genuinely empty) and
 * NULL when the read itself fails — callers must treat null as
 * "unknown", never as $0. The old catch-to-0 let a midnight DB blip
 * render "burn $0.00" AND write the day's cost_alert idempotency row,
 * silencing budget paging for the rest of the day (2026-07-30 sweep).
 */
export async function computeTodayBurn(at: Date = new Date()): Promise<number | null> {
  const start = todayStartUtc(at);
  try {
    const agg = await prisma.aiGeneration.aggregate({
      where: { createdAt: { gte: start } },
      _sum: { costCents: true },
    });
    return agg._sum.costCents ?? 0;
  } catch (err) {
    logger.warn("cost_slo_burn_read_failed", {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
    return null;
  }
}

/**
 * Linear 24h extrapolation of today's burn from hours-elapsed.
 *
 * forecast = burn · (24 / hoursElapsed)
 *
 * Why linear (and not weighted-toward-busy-hours): AI traffic on this
 * OS is operator-driven, not customer-driven · the operator's day
 * spans ~14h with weak time-of-day clustering. A simple linear cast is
 * within ±15% of actual in spot-checks and is the model we can defend
 * without a per-hour seasonality table. Refine when the dataset
 * justifies it.
 */
export async function computeBurnRateForecast(
  at: Date = new Date(),
): Promise<{ burnCents: number; hoursElapsed: number; forecastCents: number } | null> {
  const burnCents = await computeTodayBurn(at);
  if (burnCents === null) return null; // failed read — never forecast from a fabricated $0
  const hoursElapsed = hoursElapsedToday(at);
  const forecastCents = Math.round((burnCents * 24) / hoursElapsed);
  return { burnCents, hoursElapsed, forecastCents };
}

/**
 * Threshold trip: forecast > budget · 1.2.
 *
 * 1.2 multiplier is intentional — we don't want to fire on a noon spike
 * that flattens by 4pm. Anything ≤1.2x budget at any single sample is
 * still recoverable by an evening lull.
 */
export async function isOverBudget(at: Date = new Date()): Promise<{
  over: boolean;
  burnCents: number;
  forecastCents: number;
  budgetCents: number;
  thresholdCents: number;
  hoursElapsed: number;
} | null> {
  const forecast = await computeBurnRateForecast(at);
  if (forecast === null) return null; // unknown burn — callers must not treat as under-budget
  const { burnCents, forecastCents, hoursElapsed } = forecast;
  const budgetCents = await resolveDailyAiBudgetCents();
  const thresholdCents = Math.round(budgetCents * BURN_THRESHOLD_MULTIPLIER);
  return {
    over: forecastCents > thresholdCents,
    burnCents,
    forecastCents,
    budgetCents,
    thresholdCents,
    hoursElapsed,
  };
}

/**
 * Top conversations by cost over the last `days` days.
 *
 * v10.0.529.106 · Wave 59 · groups by `conversationId` (added in this
 * wave). Falls back to `feature` for non-chat callers (cron · brain ·
 * social writes that pass null conversationId). Rows with both
 * conversationId AND feature visible let the operator drill from
 * "which chat is most expensive" → into the chat thread directly.
 */
export async function topConversationsByCost(
  days: number = 7,
  limit: number = 10,
): Promise<Array<{ key: string; costCents: number; calls: number; conversationId: string | null }>> {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  try {
    // Two groupings · conversations get conversationId · everything else
    // groups by feature so cron/brain spend still surfaces with a name.
    const [byConv, byFeat] = await Promise.all([
      prisma.aiGeneration.groupBy({
        by: ["conversationId"],
        where: { createdAt: { gte: since }, conversationId: { not: null } },
        _sum: { costCents: true },
        _count: { _all: true },
      }),
      prisma.aiGeneration.groupBy({
        by: ["feature"],
        where: { createdAt: { gte: since }, conversationId: null },
        _sum: { costCents: true },
        _count: { _all: true },
      }),
    ]);
    const out = [
      ...byConv.map((r) => ({
        key: r.conversationId || "unknown-conv",
        costCents: r._sum.costCents ?? 0,
        calls: r._count._all,
        conversationId: r.conversationId,
      })),
      ...byFeat.map((r) => ({
        key: r.feature || "unknown",
        costCents: r._sum.costCents ?? 0,
        calls: r._count._all,
        conversationId: null,
      })),
    ];
    return out
      .sort((a, b) => b.costCents - a.costCents)
      .slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}

/**
 * Per-provider cost breakdown over the last `days` days. "Provider"
 * is derived from the model name prefix (same heuristic used by
 * /system/ai-cost: anthropic/openai/venice/ollama/cohere etc.).
 *
 * Returns `[{ provider, costCents, calls, byFeature }]` sorted by spend.
 */
export async function costByProvider(
  days: number = 7,
): Promise<
  Array<{
    provider: string;
    costCents: number;
    calls: number;
    byFeature: Array<{ feature: string; costCents: number; calls: number }>;
  }>
> {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  try {
    const rows = await prisma.aiGeneration.groupBy({
      by: ["model", "feature"],
      where: { createdAt: { gte: since } },
      _sum: { costCents: true },
      _count: { _all: true },
    });
    const byProvider = new Map<
      string,
      {
        provider: string;
        costCents: number;
        calls: number;
        byFeature: Map<string, { feature: string; costCents: number; calls: number }>;
      }
    >();
    for (const r of rows) {
      const provider = providerOf(r.model);
      const cost = r._sum.costCents ?? 0;
      const calls = r._count._all;
      const feat = r.feature || "unknown";
      const slot = byProvider.get(provider) ?? {
        provider,
        costCents: 0,
        calls: 0,
        byFeature: new Map(),
      };
      slot.costCents += cost;
      slot.calls += calls;
      const featSlot = slot.byFeature.get(feat) ?? {
        feature: feat,
        costCents: 0,
        calls: 0,
      };
      featSlot.costCents += cost;
      featSlot.calls += calls;
      slot.byFeature.set(feat, featSlot);
      byProvider.set(provider, slot);
    }
    return [...byProvider.values()]
      .map((p) => ({
        provider: p.provider,
        costCents: p.costCents,
        calls: p.calls,
        byFeature: [...p.byFeature.values()].sort((a, b) => b.costCents - a.costCents),
      }))
      .sort((a, b) => b.costCents - a.costCents);
  } catch {
    return [];
  }
}

/**
 * 7-day daily sparkline of spend in cents · oldest-first.
 * Used by the cockpit tile. ET day keys; missing days are 0.
 */
export async function sparkline7d(at: Date = new Date()): Promise<
  Array<{ date: string; costCents: number }>
> {
  const out: Array<{ date: string; costCents: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(at.getTime() - i * 24 * 60 * 60 * 1000);
    const key = etDateKey(day);
    const start = todayStartUtc(day);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    try {
      const agg = await prisma.aiGeneration.aggregate({
        where: { createdAt: { gte: start, lt: end } },
        _sum: { costCents: true },
      });
      out.push({ date: key, costCents: agg._sum.costCents ?? 0 });
    } catch {
      out.push({ date: key, costCents: 0 });
    }
  }
  return out;
}

/**
 * Provider classification from model name. Public so the route + tile
 * use a consistent label. Order matters — `claude-haiku-3.5` must hit
 * anthropic before any substring fallback.
 */
export function providerOf(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("claude") || m.includes("anthropic")) return "anthropic";
  if (m.includes("gpt") || m.includes("openai") || m.startsWith("o1") || m.startsWith("o3")) return "openai";
  if (m.includes("qwen") || m.includes("deepseek-v4") || m.includes("kimi")) return "ollama";
  if (m.includes("venice") || m.includes("heretic") || m.includes("glm") || m.includes("dolphin")) return "openrouter";
  if (m.includes("cohere") || m.includes("rerank")) return "cohere";
  if (
    m.includes("flux") ||
    m.includes("recraft") ||
    m.includes("z-image") ||
    m.includes("seedream") ||
    m.includes("nano-banana") ||
    m.includes("qwen-image")
  ) {
    return "openrouter"; // image models route through openrouter
  }
  return "other";
}
