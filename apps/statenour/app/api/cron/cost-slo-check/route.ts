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
import { etDateKey, isOverBudget } from "@/lib/services/cost-slo";
import { recordCoachEvent } from "@/lib/services/coach-events";

export const maxDuration = 60;

/**
 * 2026-07-07 · auto-throttle. Alert-only was the gap: the operator got
 * paged but nothing shed load. On breach the cron now flips
 * NICK_DEEP_REASONING off via the flag-override table (user_preferences
 * category=feature_flags — resolved BEFORE env by getFlag, 30s cache),
 * which drops hard turns to the single-pass streamer — the flag's own
 * designed fallback, so degradation is graceful. Ownership is
 * marker-gated: the cron only writes/lifts an override it created
 * (THROTTLE_MARKER row), never an operator-set one. Recovery is checked
 * on the first run of the next under-budget day (daily cadence, same as
 * the alert itself).
 */
const THROTTLE_FLAG = "NICK_DEEP_REASONING";
const THROTTLE_MARKER = "cost_throttle.NICK_DEEP_REASONING";

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
    // Recovery · lift a cron-owned throttle (marker-gated: an override
    // WITHOUT our marker is operator-set and stays untouched).
    const ownMarker = await prisma.userPreference
      .findUnique({ where: { key: THROTTLE_MARKER }, select: { id: true } })
      .catch(() => null);
    if (ownMarker) {
      await prisma.userPreference.delete({ where: { key: THROTTLE_FLAG } }).catch(() => undefined);
      await prisma.userPreference.delete({ where: { key: THROTTLE_MARKER } }).catch(() => undefined);
      try {
        await sendTelegram(
          `✅ Cost SLO recovered · deep-reasoning throttle lifted (env value governs again)`,
          undefined,
          "HTML",
        );
      } catch {
        // best-effort
      }
    }

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

  // Over budget · throttle first, then page. The override only lands
  // when none exists OR we own the existing one (marker present) — a
  // manual operator override always wins.
  let throttleNote = "";
  try {
    const existingOverride = await prisma.userPreference
      .findUnique({ where: { key: THROTTLE_FLAG }, select: { id: true } })
      .catch(() => null);
    const ownMarker = await prisma.userPreference
      .findUnique({ where: { key: THROTTLE_MARKER }, select: { id: true } })
      .catch(() => null);
    if (!existingOverride || ownMarker) {
      await prisma.userPreference.upsert({
        where: { key: THROTTLE_FLAG },
        update: { value: "false", category: "feature_flags" },
        create: { key: THROTTLE_FLAG, value: "false", type: "boolean", category: "feature_flags" },
      });
      await prisma.userPreference.upsert({
        where: { key: THROTTLE_MARKER },
        update: { value: today },
        create: { key: THROTTLE_MARKER, value: today, type: "string", category: "system" },
      });
      throttleNote = `Auto-throttle: deep reasoning OFF (override) until burn recovers`;
    } else {
      throttleNote = `Auto-throttle skipped: operator-set ${THROTTLE_FLAG} override present`;
    }
  } catch (throttleErr) {
    throttleNote = `Auto-throttle FAILED: ${throttleErr instanceof Error ? throttleErr.message.slice(0, 120) : "unknown"}`;
  }

  // Push Telegram. Format mirrors morning-brief: tight,
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
    `⚙️ ${throttleNote}`,
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

  // Mastery Layer Stage A · 5th writer migration · dual-write to coach
  // channel when SLO is breached. Surfaces on /scoreboard CoachEventBanner
  // alongside cost-anomaly (different but related signals · burn-rate vs
  // statistical anomaly). subjectId = ET date · dedup one-per-day. P0
  // since this is an actual budget overrun forecast (not just unusual).
  await recordCoachEvent({
    kind: "system-alert",
    subjectId: `cost-slo:${today}`,
    priority: "P0",
    title: `Cost SLO breach · forecast $${forecast$} (${pct}% of $${budget$} budget)`,
    body: `Burn so far: $${burn$} in ${state.hoursElapsed.toFixed(1)}h · 24h forecast: $${forecast$} · threshold $${(state.thresholdCents / 100).toFixed(2)}`,
    deepLink: "/system/ai-cost",
    surfaces: ["scoreboard"],
    extra: {
      date: today,
      burnCents: state.burnCents,
      forecastCents: state.forecastCents,
      budgetCents: state.budgetCents,
      thresholdCents: state.thresholdCents,
      hoursElapsed: state.hoursElapsed,
      forecastPctOfBudget: pct,
    },
  });

  return {
    ok: true,
    pushed: telegramOk,
    date: today,
    over: true,
    burnCents: state.burnCents,
    forecastCents: state.forecastCents,
    budgetCents: state.budgetCents,
  };
});
