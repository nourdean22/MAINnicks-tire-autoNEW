/**
 * GET /api/cron/morning-brief · v10.0.524 (base) · v10.0.526 (Arc C F5)
 *
 * Composes the 7am operator brief and pushes via Telegram. Cron
 * schedule lands in vercel.json: `15 7 * * *` (7:15 AM ET daily).
 *
 * v10.0.526 · the brief now carries FOUR slices (personal · shop ·
 * wellbeing · anticipated) composed by `buildMorningBrief()`. This
 * handler is unchanged structurally — it pushes `brief.text` and
 * persists `brief.payload` (now namespaced by slice) verbatim.
 * Idempotency + dedup unchanged.
 *
 * Idempotent: write a BrainMemory(category="morning_brief") row per
 * date. If today's row already exists, skip the push (cron retries
 * shouldn't double-fire on the operator's phone).
 *
 * Why 7:15 instead of 7:00: Vercel's cron has ±30s jitter; 7:15
 * keeps the brief just after coffee while the predict cron at 6am
 * has time to finish writing today's predictions.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { buildMorningBrief } from "@/lib/services/morning-brief";
import { logger as rootLogger } from "@/lib/logger";

export const maxDuration = 60;

const log = rootLogger.withSurface("cron/morning-brief");

export const GET = cronHandler(async () => {
  const brief = await buildMorningBrief();

  // v10.0.529 H4 fix · idempotency must fail closed.
  // Pre-fix: `.catch(() => null)` collapsed Neon transients into
  // "no row exists" — Vercel cron retry then pushed the brief a
  // second time. Now we fail closed: if we can't prove we haven't
  // pushed today, we don't push. The operator can still read the
  // brief via the dashboard since the prior run's row should
  // already be persisted.
  let existing: { id: string } | null = null;
  try {
    existing = await prisma.brainMemory.findFirst({
      where: { category: "morning_brief", key: brief.date },
      select: { id: true },
    });
  } catch (err) {
    log.error("idempotency_check_failed", {
      date: brief.date,
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return {
      ok: false,
      skipped: true,
      reason: "idempotency_check_failed",
      date: brief.date,
    };
  }

  if (existing) {
    return {
      ok: true,
      skipped: true,
      reason: "already_pushed_today",
      date: brief.date,
    };
  }

  // Try Telegram first. If it fails, still record the brief — the
  // payload is durable and the operator can pull it from the
  // dashboard later.
  //
  // v10.0.529 · sendTelegram already returns false on failure
  // (lib/services/telegram.ts), so the try/catch here is defensive.
  // Log if it ever throws so a regression doesn't go silent.
  let telegramOk = false;
  try {
    telegramOk = await sendTelegram(brief.text, undefined, "HTML");
  } catch (err) {
    telegramOk = false;
    log.warn("telegram_send_threw", {
      date: brief.date,
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }

  // v10.0.529 H5 fix · the comment above promises durable persistence,
  // but `.catch(() => undefined)` swallowed write failures. Now an
  // explicit try/catch logs + flips persistOk so the cron return value
  // reflects what actually happened. ok = telegramOk || persistOk so
  // a run that lost BOTH channels is marked failed.
  let persistOk = true;
  try {
    await prisma.brainMemory.create({
      data: {
        category: "morning_brief",
        key: brief.date,
        content: brief.text,
        confidence: 0.95,
        source: "cron:morning-brief",
        metadata: {
          ...brief.payload,
          telegramOk,
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    });
  } catch (err) {
    persistOk = false;
    log.error("morning_brief_persist_failed", {
      date: brief.date,
      telegramOk,
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }

  // v10.0.526 · namespaced payload exposes which slices fired today.
  // Back-compat: top-level fields stay (drift / taskCount / calendar /
  // unkeptCommitments) so existing dashboards keep working.
  const shopPayload = (brief.payload as { shop?: Record<string, unknown> })
    .shop ?? {};
  const wellbeingPayload = (
    brief.payload as { wellbeing?: Record<string, unknown> }
  ).wellbeing ?? {};
  const anticipatedPayload = (
    brief.payload as { anticipated?: Record<string, unknown> }
  ).anticipated ?? {};

  return {
    // v10.0.529 H5 · ok reflects reality: false only if BOTH channels
    // failed. Otherwise the operator either got the Telegram push or
    // can pull from BrainMemory later.
    ok: telegramOk || persistOk,
    pushed: telegramOk,
    persisted: persistOk,
    date: brief.date,
    drift: brief.drift,
    taskCount: brief.taskCount,
    calendarConflicts: brief.calendarConflicts,
    unkeptCommitments: brief.unkeptCommitments,
    slices: {
      personal: true,
      shop: Object.keys(shopPayload).length > 0,
      wellbeing: Object.keys(wellbeingPayload).length > 0,
      anticipated: Object.keys(anticipatedPayload).length > 0,
    },
  };
});
