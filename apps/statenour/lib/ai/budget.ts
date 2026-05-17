// v10.0.209 · `server-only` is mandatory here because budget.ts
// imports prisma. Without this guard, a transitive client import
// (e.g. provider.ts dynamic-import → budget.ts) would silently
// pull @next/env → fs into the client bundle and break `next build`.
// Better to fail at compile time with a clear "you can't import
// server-only from client" message than at deploy time with an
// opaque module-not-found error.
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
import { getSetting } from "@/lib/services/settings";
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
  const limit = await getSetting<number>("ai.dailyBudgetCents", 500);
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
