/**
 * GET /api/cron/weekly-review-nudge · 2026-05-27
 *
 * Sunday-evening Telegram nudge that prompts the operator to open
 * the ReviewWizard. Lifts the Tim Challies "Do More Better" weekly
 * review ritual — without a nudge the operator has to remember to
 * sit down on Sunday and run it. With the nudge, the phone vibrates
 * Sunday at 6pm ET and the operator opens bdnick.info/tasks and taps
 * the headline button.
 *
 * Separate from the existing weekly-review cron (which runs as part
 * of mega-evening to GENERATE an AI weekly summary). This one is
 * the human-prompt half · just a 1-line Telegram + a deep-link.
 *
 * Cadence: Sundays 22:00 UTC = 6pm ET during DST, 5pm EST in winter.
 * Both land in early-evening waking hours so the operator has time
 * to actually do the wizard before bed.
 *
 * Idempotency: one BrainMemory(category="weekly_review_nudge",
 * key=ISO-week) row per week. Cron retries don't double-nudge.
 *
 * Skips when:
 *   - already sent this week (idempotency check)
 *   - TELEGRAM_BOT_TOKEN unset (sendTelegram returns false)
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { toDateString, daysAgo } from "@/lib/utils/datetime";

export const maxDuration = 30;

/** ISO week key · "YYYY-WNN" · matches the format ReviewWizard
 *  saveWeeklyReview uses, so the nudge marker + the actual saved
 *  review share the same week-anchor for cross-checking. */
function isoWeekKey(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export const GET = cronHandler(async () => {
  const weekKey = isoWeekKey();

  // Idempotency · one nudge per ISO week. Check first · if we already
  // nudged this week, return early without sending. This protects
  // against cron retries + the operator clicking "Re-run" from admin.
  const existing = await prisma.brainMemory
    .findFirst({
      where: { category: BRAIN_CATEGORIES.WEEKLY_REVIEW_NUDGE ?? "weekly_review_nudge", key: weekKey },
      select: { id: true },
    })
    .catch(() => null);

  if (existing) {
    return {
      ok: true,
      skipped: true,
      reason: "already_nudged_this_week",
      weekKey,
    };
  }

  // Quick signal · count open warnings to make the nudge feel earned
  // instead of generic. The wizard's Step 1 will surface the real
  // list · this is just the carrot.
  const weekAgo = toDateString(daysAgo(7));
  const [overdueTasks, staleTasksCount, weakGoalsCount] = await Promise.all([
    prisma.task
      .count({
        where: {
          status: { in: ["INBOX", "READY", "DOING"] },
          deletedAt: null,
          dueDate: { lt: new Date() },
        },
      })
      .catch(() => 0),
    prisma.task
      .count({
        where: {
          status: { in: ["INBOX", "READY"] },
          deletedAt: null,
          lastTouchedAt: { lt: new Date(weekAgo) },
        },
      })
      .catch(() => 0),
    prisma.lifeGoal
      .count({
        where: {
          status: "active",
          deletedAt: null,
          updatedAt: { lt: new Date(weekAgo) },
        },
      })
      .catch(() => 0),
  ]);

  const bits: string[] = [];
  if (overdueTasks > 0) bits.push(`${overdueTasks} overdue`);
  if (staleTasksCount > 0) bits.push(`${staleTasksCount} stale 7d+`);
  if (weakGoalsCount > 0) bits.push(`${weakGoalsCount} untouched goal${weakGoalsCount === 1 ? "" : "s"}`);

  const summary = bits.length > 0 ? bits.join(" · ") : "calm week · ideal for the review";

  const text = [
    `<b>🕯 Weekly review · ${weekKey}</b>`,
    `${summary}`,
    ``,
    `Open bdnick.info/tasks and tap the headline.`,
    `5 steps · ~15-25 min · ends on serve &amp; surprise.`,
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
        category: BRAIN_CATEGORIES.WEEKLY_REVIEW_NUDGE ?? "weekly_review_nudge",
        key: weekKey,
        content: `Nudged ${weekKey} · ${summary}`,
        confidence: 0.95,
        source: "cron:weekly-review-nudge",
        metadata: {
          weekKey,
          overdueTasks,
          staleTasksCount,
          weakGoalsCount,
          telegramOk,
        } as never,
      },
    })
    .catch(() => undefined);

  return {
    ok: true,
    pushed: telegramOk,
    weekKey,
    overdueTasks,
    staleTasksCount,
    weakGoalsCount,
  };
});
