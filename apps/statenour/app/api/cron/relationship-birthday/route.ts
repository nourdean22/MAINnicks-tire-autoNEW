/**
 * GET /api/cron/relationship-birthday · 2026-05-27 · Power Atlas Phase 1
 *
 * Daily morning birthday + anniversary push. Fires at 12:00 UTC = 8am ET
 * (DST) / 7am EST (winter) so the Telegram lands before the operator
 * starts the day.
 *
 * Queries PersonProfile rows where birthday or anniversary MM-DD matches
 * today (status != blown_up, deletedAt is null), then sends one
 * Telegram per match with the person's name + role + last-interaction
 * context. Idempotent per (personId, ISO date, kind) via BrainMemory
 * row with 365d TTL.
 *
 * Skips silently when:
 *   - no matches today
 *   - TELEGRAM_BOT_TOKEN unset (sendTelegram returns false)
 *   - already pushed for this person+date+kind
 *
 * NO emojis (Power Atlas surface mandate).
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const maxDuration = 30;

export const GET = cronHandler(async () => {
  const now = new Date();
  const todayMmdd = now.toISOString().slice(5, 10);
  const todayIso = now.toISOString().slice(0, 10);

  const candidates = await prisma.personProfile.findMany({
    where: {
      status: { not: "blown_up" },
      deletedAt: null,
      OR: [
        { birthday: { endsWith: todayMmdd } },
        { anniversary: { endsWith: todayMmdd } },
      ],
    },
    select: {
      id: true,
      name: true,
      role: true,
      birthday: true,
      anniversary: true,
      lastInteraction: true,
    },
  });

  if (candidates.length === 0) {
    return { ok: true, skipped: true, reason: "no_matches", todayMmdd };
  }

  let pushed = 0;
  for (const p of candidates) {
    const isBirthday = p.birthday?.endsWith(todayMmdd) ?? false;
    const dedupKey = `${p.id}:${todayIso}:${isBirthday ? "bday" : "anniv"}`;

    const existing = await prisma.brainMemory
      .findFirst({
        where: {
          category: BRAIN_CATEGORIES.RELATIONSHIP_BIRTHDAY_SENT,
          key: dedupKey,
        },
        select: { id: true },
      })
      .catch(() => null);
    if (existing) continue;

    const lastSeenStr = p.lastInteraction
      ? `Last seen ${Math.floor(
          (Date.now() - p.lastInteraction.getTime()) / 86400000,
        )}d ago.`
      : "No recent interaction logged.";

    const label = isBirthday ? "Birthday" : "Anniversary";
    const text = [
      `<b>${label} today · ${p.name}</b>`,
      `Role: ${p.role}`,
      lastSeenStr,
      ``,
      `<i>Open bdnick.info/relationships to log it.</i>`,
    ].join("\n");

    let sent = false;
    try {
      sent = await sendTelegram(text, undefined, "HTML");
    } catch {
      sent = false;
    }

    await prisma.brainMemory
      .create({
        data: {
          category: BRAIN_CATEGORIES.RELATIONSHIP_BIRTHDAY_SENT,
          key: dedupKey,
          content: `${label} push for ${p.name}${sent ? " sent" : " attempted"}`,
          confidence: 0.95,
          source: "cron:relationship-birthday",
          expiresAt: new Date(Date.now() + 365 * 86400000),
        },
      })
      .catch(() => undefined);

    if (sent) pushed++;
  }

  return { ok: true, pushed, candidates: candidates.length, todayMmdd };
});
