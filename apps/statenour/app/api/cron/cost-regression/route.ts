// /api/cron/cost-regression — alert when AI spend jumps week-over-week.
//
// v7 · BATCH 6 · Apr 28. Compares last 7d total cost to prior 7d (8-14d ago).
// Alerts when last-week is >20% higher AND last-week absolute is >$5 (prevents
// noise on tiny totals). Writes to brain_memory category=cost_alert + Telegram push.
//
// Vercel cron schedule: "0 12 * * *"  (7am Cleveland)

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/cost-regression");

export const maxDuration = 30;

export const GET = cronHandler(async () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const [thisWeek, lastWeek] = await Promise.all([
    prisma.aiGeneration.aggregate({
      where: { createdAt: { gte: new Date(now - 7 * day) } },
      _sum: { costCents: true },
    }).catch(() => null),
    prisma.aiGeneration.aggregate({
      where: { createdAt: { gte: new Date(now - 14 * day), lt: new Date(now - 7 * day) } },
      _sum: { costCents: true },
    }).catch(() => null),
  ]);

  const thisCost = thisWeek?._sum.costCents ?? 0;
  const lastCost = lastWeek?._sum.costCents ?? 0;

  const jumpPct = lastCost > 0 ? (thisCost - lastCost) / lastCost : 0;
  const absoluteJump = thisCost - lastCost;
  const shouldAlert = jumpPct > 0.20 && thisCost >= 500; // 20%+ jump AND >$5

  if (!shouldAlert) {
    return {
      ok: true,
      alerted: false,
      thisWeekCents: thisCost,
      lastWeekCents: lastCost,
      jumpPct,
      summary: `${(thisCost / 100).toFixed(2)} this week vs ${(lastCost / 100).toFixed(2)} last week — ${(jumpPct * 100).toFixed(0)}%`,
    };
  }

  // v10.0.39 — write the dedup row first, then send Telegram only
  // on success. Pre-fix: `.catch(() => {})` swallowed write failures,
  // so a sticky DB issue caused repeated daily Telegram spam (the
  // dedup key never landed → next-day cron found no existing row →
  // re-fired the alert).
  let dedupWritten = true;
  try {
    await prisma.brainMemory.create({
      data: {
        category: "cost_alert",
        key: `cost-jump:${new Date().toISOString().split("T")[0]}`,
        source: "cost_regression",
        content: `📈 AI spend jumped ${(jumpPct * 100).toFixed(0)}% week-over-week ($${(thisCost / 100).toFixed(2)} vs $${(lastCost / 100).toFixed(2)} prior).`,
        confidence: 0.95,
        metadata: {
          thisWeekCents: thisCost,
          lastWeekCents: lastCost,
          jumpPct,
          absoluteJump,
          threshold: 0.20,
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    });
  } catch (err) {
    dedupWritten = false;
    log.warn("dedup_write_failed_suppressing_telegram", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Telegram if configured. Only fire when the dedup key landed —
  // otherwise tomorrow's run would also fire and spam the operator.
  if (!dedupWritten) {
    return {
      ok: false,
      reason: "dedup_write_failed",
      jumpPct,
      summary: `dedup write failed; alert suppressed to prevent spam`,
    };
  }
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChat) {
    try {
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tgChat,
          text: `📈 AI spend regression: $${(thisCost / 100).toFixed(2)} this week vs $${(lastCost / 100).toFixed(2)} last week (+${(jumpPct * 100).toFixed(0)}%). Check /system/costs.`,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      // non-critical
    }
  }

  return {
    ok: true,
    alerted: true,
    thisWeekCents: thisCost,
    lastWeekCents: lastCost,
    jumpPct,
    summary: `🔴 ALERTED: ${(jumpPct * 100).toFixed(0)}% jump · $${(thisCost / 100).toFixed(2)} vs $${(lastCost / 100).toFixed(2)}`,
  };
});

export const POST = GET;
