/**
 * GET /api/cron/relationship-digest · 2026-05-27 · Power Atlas Phase 1
 *
 * Sunday-evening Greene-voiced weekly relationship digest. Fires at
 * 22:00 UTC = 6pm ET (DST) / 5pm EST (winter) so the Telegram lands
 * while the operator is still awake.
 *
 * Scans active PersonProfile rows (excluding blown_up + deleted),
 * filters to relational roles (friend/close_friend/family/mentor/
 * mentee/romantic/advisor/rival), and surfaces:
 *   · cooling/overdue contacts (no interaction past cadenceDays or 14d)
 *   · birthdays/anniversaries in the next 7 days
 *
 * Composes a 5-7 bullet digest via tracedAiChat in Robert Greene's
 * voice. NO emojis (matches the Power Atlas surface mandate).
 *
 * Idempotent · one BrainMemory(category=relationship_digest_sent)
 * row per ISO week. Cron retries don't double-send.
 *
 * Skips silently when:
 *   - already sent this week
 *   - no candidates (empty PersonProfile)
 *   - no signal (no cooling + no birthdays this week)
 *   - TELEGRAM_BOT_TOKEN unset (sendTelegram returns false)
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const maxDuration = 60;

/** ISO week key · "YYYY-WNN" · matches weekly-review-nudge pattern. */
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

  // Idempotency · one digest per ISO week.
  const existing = await prisma.brainMemory
    .findFirst({
      where: { category: BRAIN_CATEGORIES.RELATIONSHIP_DIGEST_SENT, key: weekKey },
      select: { id: true },
    })
    .catch(() => null);

  if (existing) {
    return { ok: true, skipped: true, reason: "already_sent_this_week", weekKey };
  }

  const candidates = await prisma.personProfile.findMany({
    where: {
      status: { not: "blown_up" },
      deletedAt: null,
      role: {
        in: [
          "friend",
          "close_friend",
          "family",
          "mentor",
          "mentee",
          "romantic",
          "advisor",
          "rival",
        ],
      },
    },
    orderBy: { lastInteraction: { sort: "asc", nulls: "last" } },
    take: 50,
    select: {
      id: true,
      name: true,
      role: true,
      status: true,
      trustScore: true,
      lastInteraction: true,
      interactionCount: true,
      cadenceDays: true,
      birthday: true,
      anniversary: true,
      applicableLaws: true,
      darkTraits: true,
      powerBalance: true,
    },
  });

  if (candidates.length === 0) {
    return { ok: true, skipped: true, reason: "no_candidates", weekKey };
  }

  const today = new Date();
  const enriched = candidates.map((p) => {
    const daysSince = p.lastInteraction
      ? Math.floor((today.getTime() - p.lastInteraction.getTime()) / 86400000)
      : null;
    const overdue =
      p.cadenceDays && daysSince !== null
        ? daysSince > p.cadenceDays
        : daysSince !== null && daysSince > 30;
    return { ...p, daysSince, overdue };
  });

  const cooling = enriched.filter((p) => p.overdue || (p.daysSince ?? 0) > 14);
  const todayMmdd = today.toISOString().slice(5, 10);
  const inSevenDaysMmdd = new Date(today.getTime() + 7 * 86400000)
    .toISOString()
    .slice(5, 10);
  const birthdaysThisWeek = enriched.filter((p) => {
    if (!p.birthday) return false;
    const mmdd = p.birthday.slice(5);
    return mmdd >= todayMmdd && mmdd <= inSevenDaysMmdd;
  });

  if (cooling.length === 0 && birthdaysThisWeek.length === 0) {
    return { ok: true, skipped: true, reason: "no_signal_this_week", weekKey };
  }

  const top5 = cooling.slice(0, 5);
  const prompt = `You are a private strategist trained in Robert Greene's full corpus (48 Laws of Power, Mastery, Laws of Human Nature, The Art of Seduction, 33 Strategies of War). Output a terse weekly relationship digest for the operator. NO emojis. NO motivational fluff. Plain prose in Greene's voice.

This week's situation:
${top5
  .map(
    (p) =>
      `- ${p.name} (${p.role}, ${p.daysSince}d silent, trust ${Math.round(
        p.trustScore * 100,
      )}, power ${p.powerBalance.toFixed(2)}, applicable laws [${p.applicableLaws.join(",")}], dark traits [${p.darkTraits.join(",")}])`,
  )
  .join("\n")}

Birthdays this week:
${
  birthdaysThisWeek.length
    ? birthdaysThisWeek
        .map((p) => `- ${p.name} (${p.role}, birthday ${p.birthday?.slice(5)})`)
        .join("\n")
    : "(none)"
}

Format the digest as 5-7 bullet lines max. Each bullet:
- Names the person
- Names the applicable Greene law (if any) by number + 4-word summary
- Names the strategic move the operator should consider this week

Do NOT recommend. Surface options. The operator decides.
End with a single line: "The strategist asks: which move this week?"`;

  let digestText = "";
  try {
    const result = await tracedAiChat(
      { label: "relationship-digest", source: "cron" },
      [
        {
          role: "system",
          content:
            "You are a private strategist channeling Robert Greene's voice. Plain prose. No emoji. No fluff.",
        },
        { role: "user", content: prompt },
      ],
      "reason",
    );
    digestText = (result.content ?? "").trim();
  } catch {
    digestText = `Weekly relationship digest · ${weekKey}\n\nCooling: ${cooling.length}. Birthdays this week: ${birthdaysThisWeek.length}. Open /relationships for detail.`;
  }

  const text = [
    `<b>Weekly relationship digest · ${weekKey}</b>`,
    ``,
    digestText,
    ``,
    `<i>Open bdnick.info/relationships</i>`,
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
        category: BRAIN_CATEGORIES.RELATIONSHIP_DIGEST_SENT,
        key: weekKey,
        content: digestText.slice(0, 4000),
        confidence: 0.95,
        source: "cron:relationship-digest",
        metadata: {
          weekKey,
          cooling: cooling.length,
          birthdays: birthdaysThisWeek.length,
          telegramOk,
        } as never,
      },
    })
    .catch(() => undefined);

  return {
    ok: true,
    pushed: telegramOk,
    weekKey,
    cooling: cooling.length,
    birthdays: birthdaysThisWeek.length,
  };
});
