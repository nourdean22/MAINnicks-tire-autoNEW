/**
 * GET /api/cron/cost-slo-check · v10.0.526 · Arc A · Feature 2
 *
 * Burn-rate sentinel. Runs inside mega-evening fan-out. Computes the
 * linear 24h extrapolation of today's AiGeneration spend and pushes
 * Telegram when forecast > daily-budget · 1.2.
 *
 * Idempotency: one BrainMemory(category="cost_alert", key=YYYY-MM-DD)
 * row per ET-day. Cron retries don't double-page the operator.
 *
 * Why folded into mega-evening: nightly check matches the "did we
 * overrun today?" cadence; daytime overruns are caught the next
 * morning. The 1.2x threshold absorbs intra-day spikes that flatten
 * by the cutoff. If sub-day alerting becomes valuable, promote to an
 * hourly cron with the same handler.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { dailyBudgetCents, etDateKey, isOverBudget } from "@/lib/services/cost-slo";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const today = etDateKey();
  const state = await isOverBudget();

  // Idempotency · one alert per ET-day. Look up existing first; if
  // a row exists for today, return early regardless of `over` so a
  // mid-day retry never re-pages the operator.
  const existing = await prisma.brainMemory
    .findFirst({
      where: { category: "cost_alert", key: today },
      select: { id: true },
    })
    .catch(() => null);

  if (existing) {
    return {
      ok: true,
      skipped: true,
      reason: "already_checked_today",
      date: today,
      over: state.over,
      burnCents: state.burnCents,
      forecastCents: state.forecastCents,
      budgetCents: state.budgetCents,
    };
  }

  // Not over budget · still write the marker so we don't re-query
  // throughout the day, but skip Telegram.
  if (!state.over) {
    await prisma.brainMemory
      .create({
        data: {
          category: "cost_alert",
          key: today,
          content: `OK · burn $${(state.burnCents / 100).toFixed(2)} · forecast $${(state.forecastCents / 100).toFixed(2)} · budget $${(state.budgetCents / 100).toFixed(2)}`,
          confidence: 0.95,
          source: "cron:cost-slo-check",
          metadata: {
            ...state,
            telegramOk: false,
            checked: "under_budget",
          } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
        },
      })
      .catch(() => undefined);

    return {
      ok: true,
      pushed: false,
      date: today,
      over: false,
      burnCents: state.burnCents,
      forecastCents: state.forecastCents,
      budgetCents: state.budgetCents,
    };
  }

  // Over budget · push Telegram. Format mirrors morning-brief: tight,
  // dollar-amount-first, no markdown clutter.
  const burn$ = (state.burnCents / 100).toFixed(2);
  const forecast$ = (state.forecastCents / 100).toFixed(2);
  const budget$ = (state.budgetCents / 100).toFixed(2);
  const pct = Math.round((state.forecastCents / Math.max(1, state.budgetCents)) * 100);

  const text = [
    `<b>Cost SLO breach · ${today}</b>`,
    `Burn so far: <b>$${burn$}</b> in ${state.hoursElapsed.toFixed(1)}h`,
    `24h forecast: <b>$${forecast$}</b> (${pct}% of budget)`,
    `Daily budget: $${budget$} · threshold $${(state.thresholdCents / 100).toFixed(2)}`,
  ].join("\n");

  let telegramOk = false;
  try {
    telegramOk = await sendTelegram(text, undefined, "HTML");
  } catch {
    telegramOk = false;
  }

  await prisma.brainMemory
    .create({
      data: {
        category: "cost_alert",
        key: today,
        content: text,
        confidence: 0.95,
        source: "cron:cost-slo-check",
        metadata: {
          ...state,
          telegramOk,
          checked: "over_budget",
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    })
    .catch(() => undefined);

  return {
    ok: true,
    pushed: telegramOk,
    date: today,
    over: true,
    burnCents: state.burnCents,
    forecastCents: state.forecastCents,
    budgetCents: dailyBudgetCents(),
  };
});
