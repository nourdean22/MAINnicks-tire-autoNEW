/**
 * Proactive Telegram pushes · v10.0.529.106 · Wave 66.
 *
 * The brain has SEVERAL layers of high-signal data that today only
 * surface when the operator opens the app:
 *   · anticipated-questions (precomputed nightly · what Nour will
 *     likely ask tomorrow)
 *   · nick-current-concerns (Wave 60 · rolling open threads from
 *     past sessions)
 *   · ghost-nick predictions (today's most-likely next moves)
 *   · proactive alerts (stale estimates · unanswered callbacks)
 *
 * Pre-Wave-66 the operator had to open chat or visit /brain to see
 * any of this. The 6-agent audit (Pattern E · "the OS knows but
 * doesn't tell") flagged this as the difference between an AI
 * assistant and a personal OS that knows you.
 *
 * This module delivers ≤3 daily micro-pushes via Telegram:
 *   1. morning (8am ET) · top anticipated question + suggested ask
 *   2. afternoon (2pm ET) · open thread that needs attention OR
 *      proactive alert if any active
 *   3. evening (9pm ET) · energy-state aware shutdown nudge
 *
 * Idempotent · each push has a per-day dedup marker in BrainMemory
 * so re-running the cron doesn't double-push.
 *
 * Skill stances: voice-agents-style minimum-friction delivery,
 * kaizen (smallest viable shipment · 3 pushes/day not 30), karpathy
 * (verifiable goal · operator gets actionable nudge before opening
 * the app).
 */

import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";
import { today } from "@/lib/utils/datetime";
import { getTodaysAnticipated } from "@/lib/brain/anticipated-questions";
import { getNickCurrentConcerns } from "@/lib/brain/session-distiller";

const log = rootLogger.withSurface("brain/proactive-pushes");

type PushSlot = "morning" | "afternoon" | "evening";

interface PushResult {
  slot: PushSlot;
  fired: boolean;
  reason: string;
  text?: string;
}

/**
 * Idempotency · prevent duplicate pushes on cron retries. Marker
 * lives in BrainMemory with a per-day key so multiple fires of the
 * same slot on the same day are no-ops.
 */
async function markPushSent(slot: PushSlot, dateKey: string): Promise<void> {
  await prisma.brainMemory.upsert({
    where: { category_key: { category: "proactive_push_sent", key: `${slot}_${dateKey}` } },
    create: {
      category: "proactive_push_sent",
      key: `${slot}_${dateKey}`,
      content: `${slot} push sent at ${new Date().toISOString()}`,
      source: "proactive_push_cron",
      confidence: 1.0,
      expiresAt: new Date(Date.now() + 48 * 3600_000), // 48h TTL
    },
    update: {
      content: `${slot} push sent at ${new Date().toISOString()}`,
      lastSeen: new Date(),
    },
  });
}

async function alreadyPushed(slot: PushSlot, dateKey: string): Promise<boolean> {
  const row = await prisma.brainMemory.findUnique({
    where: { category_key: { category: "proactive_push_sent", key: `${slot}_${dateKey}` } },
    select: { id: true },
  }).catch(() => null);
  return row !== null;
}

/**
 * Get today's body entry for the energy-aware evening push.
 * Returns null when nothing logged today · downstream gracefully
 * degrades to a generic evening shutdown nudge.
 */
async function getTodayBody(): Promise<{ sleepHours?: number | null; energy?: number | null } | null> {
  const dateStr = today();
  const row = await prisma.bodyTracking.findUnique({
    where: { date: dateStr },
    select: { sleepHours: true, energy: true },
  }).catch(() => null);
  return row;
}

/**
 * Morning push (8am ET) · anticipated question + suggested ask.
 * Pulls the top question from getTodaysAnticipated() and sends it
 * as a one-line Telegram prompt. Operator can tap-to-open chat.
 */
export async function fireMorningPush(): Promise<PushResult> {
  const dateKey = today();
  if (await alreadyPushed("morning", dateKey)) {
    return { slot: "morning", fired: false, reason: "already_pushed_today" };
  }
  const set = await getTodaysAnticipated().catch(() => null);
  if (!set || set.questions.length === 0) {
    return { slot: "morning", fired: false, reason: "no_anticipated_set" };
  }
  const top = set.questions[0];
  const text =
    `☀️ <b>Morning · Nick's pick</b>\n\n` +
    `Today you'll likely want to know:\n` +
    `<i>"${top.question}"</i>\n\n` +
    `Tap to ask Nick · already warmed.`;
  const ok = await sendTelegram(text).catch(() => false);
  if (ok) await markPushSent("morning", dateKey);
  return {
    slot: "morning",
    fired: ok,
    reason: ok ? "sent" : "telegram_failed",
    text: ok ? text : undefined,
  };
}

/**
 * Afternoon push (2pm ET) · open thread that needs attention.
 * Uses Wave 60 getNickCurrentConcerns() · pulls the most-recent
 * unresolved thread from past sessions. Falls back to silent
 * when no concerns exist · don't push noise.
 */
export async function fireAfternoonPush(): Promise<PushResult> {
  const dateKey = today();
  if (await alreadyPushed("afternoon", dateKey)) {
    return { slot: "afternoon", fired: false, reason: "already_pushed_today" };
  }
  const concerns = await getNickCurrentConcerns().catch(() => null);
  if (!concerns || concerns.threads.length === 0) {
    return { slot: "afternoon", fired: false, reason: "no_open_threads" };
  }
  const top = concerns.threads[0];
  const ageH = Math.round((Date.now() - new Date(top.sourceLastAt).getTime()) / 3600_000);
  const ageStr = ageH < 24 ? `${ageH}h` : `${Math.round(ageH / 24)}d`;
  const mark = top.kind === "followup" ? "→" : "?";
  const text =
    `🎯 <b>Open thread · ${ageStr} old</b>\n\n` +
    `${mark} ${top.text}\n\n` +
    `Tap to pick it back up.`;
  const ok = await sendTelegram(text).catch(() => false);
  if (ok) await markPushSent("afternoon", dateKey);
  return {
    slot: "afternoon",
    fired: ok,
    reason: ok ? "sent" : "telegram_failed",
    text: ok ? text : undefined,
  };
}

/**
 * Evening push (9pm ET) · energy-aware shutdown nudge.
 * Reads today's body entry. If energy ≤ 2 OR sleep < 6h today:
 * suggests early shutdown. Otherwise: standard end-of-day review.
 * If body data is missing entirely: standard nudge.
 */
export async function fireEveningPush(): Promise<PushResult> {
  const dateKey = today();
  if (await alreadyPushed("evening", dateKey)) {
    return { slot: "evening", fired: false, reason: "already_pushed_today" };
  }
  const body = await getTodayBody();
  let text: string;
  if (body && (
    (typeof body.sleepHours === "number" && body.sleepHours < 6) ||
    (typeof body.energy === "number" && body.energy <= 2)
  )) {
    text =
      `🌙 <b>Evening · recovery mode</b>\n\n` +
      (typeof body.sleepHours === "number" && body.sleepHours < 6
        ? `You slept ${body.sleepHours.toFixed(1)}h last night. `
        : `Energy was low today. `) +
      `Don't push the night shift · close 1 thing and head down.`;
  } else {
    text =
      `🌙 <b>Evening check-in</b>\n\n` +
      `Log today's score + tomorrow's MIT before bed. ` +
      `2-min ritual · keeps the streak alive.`;
  }
  const ok = await sendTelegram(text).catch(() => false);
  if (ok) await markPushSent("evening", dateKey);
  return {
    slot: "evening",
    fired: ok,
    reason: ok ? "sent" : "telegram_failed",
    text: ok ? text : undefined,
  };
}

/**
 * Smart router · fires the slot that matches the current ET hour.
 * Called by the cron · single endpoint can serve all 3 slots so
 * we don't need 3 separate cron paths.
 *
 * Hour mapping (ET):
 *   · 6-11  → morning
 *   · 12-17 → afternoon
 *   · 18-23 → evening
 *   · 0-5   → skip (operator should be sleeping)
 */
export async function fireSlotForCurrentHour(): Promise<PushResult | { skipped: true; reason: string }> {
  const now = new Date();
  const etHour = parseInt(
    now.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "America/New_York" }),
    10,
  );
  if (etHour >= 6 && etHour <= 11) {
    log.info("slot_dispatch", { slot: "morning", etHour });
    return fireMorningPush();
  }
  if (etHour >= 12 && etHour <= 17) {
    log.info("slot_dispatch", { slot: "afternoon", etHour });
    return fireAfternoonPush();
  }
  if (etHour >= 18 && etHour <= 23) {
    log.info("slot_dispatch", { slot: "evening", etHour });
    return fireEveningPush();
  }
  return { skipped: true, reason: `overnight_hour_${etHour}` };
}
