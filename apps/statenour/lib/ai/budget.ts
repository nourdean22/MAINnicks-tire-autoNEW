// v10.0.209 · `server-only` is mandatory here because budget.ts
// imports prisma. Without this guard, a transitive client import
// (e.g. provider.ts dynamic-import → budget.ts) would silently
// pull @next/env → fs into the client bundle and break `next build`.
// Better to fail at compile time with a clear "you can't import
// server-only from client" message than at deploy time with an
// opaque module-not-found error.
import { getSetting } from "@/lib/services/settings";
import "server-only";

/**
 * Daily AI cost budget · enforcement layer
 *
 * Pre-v10.0.208: this module exposed read surfaces only (checkBudget,
 * getBudgetHistory) consumed by /system/costs and /system/ai-analytics
 * dashboards. There was no enforcement — the budget setting was
 * decorative.
 *
 * Post-v10.0.208/209: the chat route gates on `assertWithinBudget()`
 * before opening a streamText() pipe. When today's costCents on
 * AiGeneration ≥ `ai.dailyBudgetCents` setting (default 500¢), the
 * route returns 402 with `budgetExceeded:true` instead of burning
 * more spend.
 *
 * Note: aiChat() does NOT gate inline. v10.0.208 tried that and broke
 * the production build because provider.ts is reachable from a client
 * component chain and dynamic-importing this module pulled prisma →
 * @next/env → fs into the client bundle. Server callers that need
 * pre-flight enforcement (currently only the chat route) call
 * assertWithinBudget() themselves; the `import "server-only"` guard
 * above ensures any future client leak fails at compile time.
 *
 * Cache: 60s in-process. Collapses per-call cost to ≤1 DB aggregate
 * per minute per serverless instance. Worst-case enforcement latency
 * is 60s after crossing the cap — fine for a daily-cap signal.
 */
import { prisma } from "@/lib/prisma";
import { resolveDailyAiBudgetCents } from "@/lib/services/cost-slo";
import { startOfDay, toDateString } from "@/lib/utils/datetime";

export interface BudgetStatus {
  spent: number;       // cents spent today
  limit: number;       // daily budget in cents
  remaining: number;   // cents remaining
  percentUsed: number; // 0-100
  overBudget: boolean;
}

/** Check today's AI spend against the configured daily budget */
export async function checkBudget(): Promise<BudgetStatus> {
  const limit = await resolveDailyAiBudgetCents();
  const todayStart = startOfDay();

  const result = await prisma.aiGeneration.aggregate({
    where: { createdAt: { gte: todayStart } },
    _sum: { costCents: true },
  });

  const spent = result._sum.costCents ?? 0;
  const remaining = Math.max(0, limit - spent);
  const percentUsed = limit > 0 ? Math.round((spent / limit) * 100) : 0;

  return {
    spent,
    limit,
    remaining,
    percentUsed,
    overBudget: spent >= limit,
  };
}

/** Get daily spend history for the last N days */
export async function getBudgetHistory(days: number): Promise<{ date: string; spent: number }[]> {
  const results: { date: string; spent: number }[] = [];

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = toDateString(d);
    const dayStart = new Date(dateStr);
    const dayEnd = new Date(dateStr);
    dayEnd.setHours(23, 59, 59, 999);

    const agg = await prisma.aiGeneration.aggregate({
      where: { createdAt: { gte: dayStart, lte: dayEnd } },
      _sum: { costCents: true },
    });

    results.push({ date: dateStr, spent: agg._sum.costCents ?? 0 });
  }

  return results;
}

// ─── v10.0.208 · enforcement layer ──────────────────────────────────

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  status: BudgetStatus;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

/**
 * Returns the current budget status, using a 60s in-process cache.
 * Cheap enough to call from every aiChat() invocation; the cache
 * collapses the per-instance read load to ~1/min.
 */
export async function getCachedBudgetStatus(): Promise<BudgetStatus> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.status;
  }
  const status = await checkBudget();
  cache = { status, expiresAt: now + CACHE_TTL_MS };
  return status;
}

/**
 * Pre-flight gate for AI calls. Returns `{ ok: true }` when there's
 * spend headroom, `{ ok: false, status }` when today already crossed
 * the cap. Callers are expected to short-circuit to an emergency-tier
 * response when not ok.
 */
export async function assertWithinBudget(): Promise<
  | { ok: true; status: BudgetStatus }
  | { ok: false; status: BudgetStatus }
> {
  const status = await getCachedBudgetStatus();
  return { ok: !status.overBudget, status };
}

/**
 * Test/debug helper: forcibly drop the cache so the next read hits
 * the database. Used by tests to assert post-spend behavior without
 * waiting 60s.
 */
export function _resetBudgetCache(): void {
  cache = null;
}

/**
 * Thrown by the edge-wrap budget gate inside tracedAiChat() when today's
 * spend has crossed the daily cap.
 *
 * Caller patterns:
 *   - Background crons / specialists / brain engines: let the error
 *     bubble; the cron's try/catch logs the failure and exits gracefully.
 *     Better than burning more spend during a budget overflow.
 *   - Interactive surfaces (chat route): gate manually BEFORE calling
 *     into traced-aichat, returning a 402 with structured payload for
 *     inline UI rendering. The chat route already does this since
 *     v10.0.208; the tracedAiChat edge-wrap (wave-AO) inherits the gate
 *     to every server-side callsite that previously bypassed it.
 *
 * Why not in provider.ts? · v10.0.208 tried that and broke `next build`
 * because provider.ts is reachable from a client component chain
 * (chat/page.tsx → use-chat-auto-fire → auto-fire-gate → content-intent
 * → provider). traced-aichat.ts is server-only-reachable, so dynamic-
 * importing budget.ts here is safe.
 */
export class BudgetExceededError extends Error {
  status: BudgetStatus;
  constructor(status: BudgetStatus) {
    super(
      `Daily AI budget reached ($${(status.spent / 100).toFixed(2)} of $${(status.limit / 100).toFixed(2)}). Raise the cap in Settings → AI.`,
    );
    this.name = "BudgetExceededError";
    this.status = status;
  }
}

// ── U6 (2026-09-08) · per-lane budgets ──────────────────────────────────────
// A lane is the `feature` a call is recorded under (chat, ai:reason, plan_day…).
// Caps: setting `ai.laneBudgetCents` (JSON map), else env AI_LANE_BUDGET_CENTS_JSON.
// A capped lane at or past its cap is a deterministic stop in aiChat.

export const LANE_BUDGET_SETTING_KEY = "ai.laneBudgetCents";
export const LANE_BUDGET_ENV_KEY = "AI_LANE_BUDGET_CENTS_JSON";
const LANE_CACHE_TTL_MS = 30_000;

export interface LaneStatus {
  feature: string;
  spentCents: number;
  capCents: number | null;
  over: boolean;
}

export function parseLaneCaps(raw: unknown): Record<string, number> {
  if (typeof raw !== "string" || raw.trim().length === 0) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isInteger(v) && v > 0 && k.trim().length > 0) out[k.trim()] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function getLaneCaps(): Promise<{ caps: Record<string, number>; source: "setting" | "env" | "none" }> {
  const stored = await getSetting<unknown>(LANE_BUDGET_SETTING_KEY, null);
  const fromSetting = parseLaneCaps(stored);
  if (Object.keys(fromSetting).length > 0) return { caps: fromSetting, source: "setting" };
  const fromEnv = parseLaneCaps(process.env[LANE_BUDGET_ENV_KEY]);
  if (Object.keys(fromEnv).length > 0) return { caps: fromEnv, source: "env" };
  return { caps: {}, source: "none" };
}

const laneCache = new Map<string, { at: number; status: LaneStatus }>();
export function resetLaneBudgetCache(): void {
  laneCache.clear();
}

/** Today's spend for one lane against its cap. Throws on a failed read — never a silent zero. */
export async function checkLaneBudget(feature: string): Promise<LaneStatus> {
  const hit = laneCache.get(feature);
  if (hit && Date.now() - hit.at < LANE_CACHE_TTL_MS) return hit.status;
  const { caps } = await getLaneCaps();
  const capCents = caps[feature] ?? null;
  const agg = await prisma.aiGeneration.aggregate({
    where: { feature, createdAt: { gte: startOfDay() } },
    _sum: { costCents: true },
  });
  const spentCents = agg._sum.costCents ?? 0;
  const status: LaneStatus = { feature, spentCents, capCents, over: capCents != null && spentCents >= capCents };
  laneCache.set(feature, { at: Date.now(), status });
  return status;
}

/** Every capped lane, plus today's uncapped spenders — for the /system cost page. */
export async function listLaneStatus(): Promise<{ lanes: LaneStatus[]; source: "setting" | "env" | "none" }> {
  const { caps, source } = await getLaneCaps();
  const rows = await prisma.aiGeneration.groupBy({
    by: ["feature"],
    where: { createdAt: { gte: startOfDay() } },
    _sum: { costCents: true },
  });
  const spent = new Map<string, number>();
  for (const r of rows) spent.set(r.feature ?? "unknown", r._sum.costCents ?? 0);
  const features = [...new Set([...Object.keys(caps), ...spent.keys()])];
  const lanes = features
    .map((feature) => {
      const capCents = caps[feature] ?? null;
      const spentCents = spent.get(feature) ?? 0;
      return { feature, spentCents, capCents, over: capCents != null && spentCents >= capCents };
    })
    .sort((a, b) => Number(b.capCents != null) - Number(a.capCents != null) || b.spentCents - a.spentCents);
  return { lanes, source };
}
