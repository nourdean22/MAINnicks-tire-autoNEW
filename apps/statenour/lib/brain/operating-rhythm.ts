/**
 * ADHD Operating Rhythm Engine
 *
 * Nick doesn't just SUGGEST a daily rhythm — he ENFORCES it.
 * Sends Telegram messages at key times to keep Nour on track.
 *
 * Schedule (all times ET):
 * 7:00 AM  — Morning autopilot (already exists)
 * 8:00 AM  — Peak block starts. Nick guards focus.
 * 11:00 AM — Mid-morning check. Revenue + callbacks + focus hours left.
 * 2:00 PM  — Operations shift. Pipeline aging alert.
 * 5:00 PM  — Pre-close. Today's score + missing items.
 * 9:00 PM  — Shutdown ritual. Log score + tomorrow's MIT. No new commitments.
 *
 * ADHD-specific guardrails:
 * - Evening commitments get pushback ("You've abandoned 60% of after-9pm commitments")
 * - Detects system-building during peak revenue hours
 * - Tracks commitment timing → quality correlation
 * - Enforces "one thing at a time" during peak block
 *
 * All messages are concise, direct, and data-backed. No motivational fluff.
 */

import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { queryNick } from "@/lib/nickstire/query";
import { readNickRevenue } from "@/lib/nickstire/revenue";
import { brainMemory } from "@/lib/brain/memory-manager";
import { today } from "@/lib/utils/datetime";
import { MONTHLY_REVENUE_TARGET } from "@/lib/config/business";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("brain/operating-rhythm");

// 2026-05-27 · operator volume cleanup · "shutdown" slot retired.
// proactive-push evening slot at 9pm ET already covers the same
// territory (per-day deduplicated, energy-aware) so this was a
// structurally redundant ping. Down from 5 → 4 slots.
type RhythmSlot = "peak_start" | "mid_morning" | "operations" | "pre_close";

/**
 * Get the current rhythm slot based on time of day.
 */
function getCurrentSlot(): RhythmSlot | null {
  const hour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    10
  );

  if (hour === 8) return "peak_start";
  if (hour === 11) return "mid_morning";
  if (hour === 14) return "operations";
  if (hour === 17) return "pre_close";
  // 9pm ET (hour === 21) retired · proactive-push evening covers it.
  return null;
}

/**
 * 2026-05-27 · operator volume cleanup · per-slot per-day dedup
 * marker. Pre-fix: operating-rhythm had ZERO dedup, so Vercel cron
 * retries / Railway restarts / manual triggers could fire the same
 * slot's Telegram twice. Up to 5 slots × possible doubles = 10
 * pings/day risk on this lane alone. Pattern copied from
 * lib/brain/proactive-pushes.ts:57-81 — reuse PROACTIVE_PUSH_SENT
 * category with `rhythm_` key prefix so the existing 14d TTL hygiene
 * cron also reaps these (no new category needed).
 */
async function rhythmAlreadyPushed(slot: RhythmSlot, dateKey: string): Promise<boolean> {
  const row = await prisma.brainMemory
    .findUnique({
      where: {
        category_key: {
          category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT,
          key: `rhythm_${slot}_${dateKey}`,
        },
      },
      select: { id: true },
    })
    .catch((err) => {
      logError("brain.operating-rhythm", err, { fn: "rhythmAlreadyPushed" });
      return null;
    });
  return row !== null;
}

async function markRhythmPushed(slot: RhythmSlot, dateKey: string): Promise<void> {
  await prisma.brainMemory
    .upsert({
      where: {
        category_key: {
          category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT,
          key: `rhythm_${slot}_${dateKey}`,
        },
      },
      create: {
        category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT,
        key: `rhythm_${slot}_${dateKey}`,
        content: `rhythm ${slot} pushed at ${new Date().toISOString()}`,
        source: "operating-rhythm-cron",
        confidence: 1.0,
        expiresAt: new Date(Date.now() + 48 * 3600_000),
      },
      update: {
        content: `rhythm ${slot} pushed at ${new Date().toISOString()}`,
        lastSeen: new Date(),
      },
    })
    .catch((err) => {
      logError("brain.operating-rhythm", err, { fn: "markRhythmPushed" });
      return undefined;
    });
}

/**
 * Execute the rhythm for the current time slot.
 * Called by cron at each slot time.
 */
export async function executeRhythm(slot?: RhythmSlot): Promise<{
  slot: string;
  sent: boolean;
  message: string;
}> {
  const activeSlot = slot || getCurrentSlot();
  if (!activeSlot) return { slot: "none", sent: false, message: "Not a rhythm slot hour" };

  // Check if rhythm is enabled
  const flag = await prisma.userPreference.findUnique({
    where: { key: "autopilot_flags" },
    select: { value: true },
  }).catch((err): null => {
    logError("brain.operating-rhythm", err, { fn: "executeRhythm.findFlag" });
    return null;
  });

  let rhythmEnabled = true; // Default on
  if (flag?.value) {
    try {
      const flags = JSON.parse(flag.value);
      if (flags.adhd_operating_rhythm === false) rhythmEnabled = false;
    } catch (err) {
      logError("brain.operating-rhythm", err, { fn: "executeRhythm.parseFlag" });
    }
  }

  if (!rhythmEnabled) return { slot: activeSlot, sent: false, message: "Rhythm disabled" };

  // Gather context
  // v10.0.42 — wire shop data via the queryNick bridge. Pre-fix all
  // four shop fields (todayScore, recentJobs, staleLeads, pendingCallbacks)
  // were dead `Promise.resolve(null/[]/0)` placeholders, so EVERY
  // Telegram message at all 5 daily slots reported $0 revenue, 0
  // stale leads, 0 callbacks regardless of actual shop state. Now
  // they read live data from nickstire via STATENOUR_SYNC_KEY.
  const todayStr = today();
  const [todayScore, openLoops, commitments, revRes, staleLeadsRes, callbacksRes] = await Promise.all([
    // Brain-maturity score (still local — not in nickstire).
    prisma.brainMemory
      .findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
        select: { content: true },
      })
      .then((row) => {
        if (!row?.content) return null;
        try {
          const parsed = JSON.parse(row.content) as { score?: number };
          return typeof parsed.score === "number" ? parsed.score : null;
        } catch {
          return null;
        }
      })
      .catch((err): null => {
        logError("brain.operating-rhythm", err, { fn: "executeRhythm.getScore" });
        return null;
      }),
    prisma.task.count({ where: { status: { in: ["INBOX", "READY", "DOING"] } } }).catch((err): number => {
      logError("brain.operating-rhythm", err, { fn: "executeRhythm.countTasks" });
      return 0;
    }),
    prisma.commitment.count({ where: { status: { in: ["active", "in_progress"] } } }).catch((err): number => {
      logError("brain.operating-rhythm", err, { fn: "executeRhythm.countCommitments" });
      return 0;
    }),
    queryNick<{ totalDollars?: number; invoiceCount?: number }>("revenue_today").catch((err) => {
      logError("brain.operating-rhythm", err, { fn: "executeRhythm.queryRevenue" });
      return { error: "fetch failed" };
    }),
    queryNick<{ count?: number; leads?: unknown[]; items?: unknown[] }>("leads_urgent").catch((err) => {
      logError("brain.operating-rhythm", err, { fn: "executeRhythm.queryLeads" });
      return { error: "fetch failed" };
    }),
    queryNick<{ count: number }>("callbacks_pending").catch((err) => {
      logError("brain.operating-rhythm", err, { fn: "executeRhythm.queryCallbacks" });
      return { error: "fetch failed" };
    }),
  ]);

  // Unwrap query results — shape is `{ data, query, timestamp }` on
  // success or `{ error }` on failure. On failure we degrade
  // gracefully to zeros (warn-logged via structured logger so
  // /system/errors surfaces persistent bridge failures with surface
  // attribution).
  // 2026-05-30 · was "jobs_today" (a dead bridge query → recentJobs always
  // [], silently zeroing revenue). That made the weekday "🔴 ZERO REVENUE"
  // cliff banner fire EVERY weekday and printed "$0" at every slot regardless
  // of real shop state. Remapped to the live revenue_today query, read through
  // the canonical readNickRevenue() so the payload contract can't drift again.
  const revData = "data" in revRes ? (revRes as { data?: unknown }).data : undefined;
  const { todayDollars: todayRevenue, jobs: todayJobCount } = readNickRevenue(revData);
  if ("error" in revRes) {
    log.warn("bridge_query_failed", { query: "revenue_today", error: revRes.error });
  }
  // 2026-05-30 · was "stale_leads_count" (a dead bridge query → always 0).
  // Remapped to leads_urgent (live). Shape-tolerant: count | leads[] | items[].
  const staleLeadsData =
    "data" in staleLeadsRes
      ? (staleLeadsRes as { data?: { count?: number; leads?: unknown[]; items?: unknown[] } }).data
      : undefined;
  const staleLeads = Number(
    staleLeadsData?.count ?? staleLeadsData?.leads?.length ?? staleLeadsData?.items?.length ?? 0,
  );
  if ("error" in staleLeadsRes) {
    log.warn("bridge_query_failed", { query: "leads_urgent", error: staleLeadsRes.error });
  }
  // 2026-05-30 · was "pending_callbacks_count" (dead → always 0). Remapped to
  // the live callbacks_pending query ({ pending, count }); we read .count.
  const pendingCallbacks =
    "data" in callbacksRes
      ? Number((callbacksRes as { data?: { count?: number } }).data?.count ?? 0)
      : 0;
  if ("error" in callbacksRes) {
    log.warn("bridge_query_failed", { query: "callbacks_pending", error: callbacksRes.error });
  }

  let message = "";

  switch (activeSlot) {
    case "peak_start":
      // 8 AM — Peak block starts
      // v10.0.46 — fixed inverted MIT picker. Pre-fix
      // `orderBy: { autoPriority: "desc" }` returned the task with
      // the HIGHEST autoPriority value, but autoPriority is 0-100
      // where 0 = MOST urgent. So every morning's 8am Telegram has
      // been telling Nour to focus on the LEAST urgent task as his
      // "MIT". Catastrophic bug that made the rhythm engine actively
      // anti-helpful. Switched to `asc` + added `deletedAt: null`
      // (soft-deleted tasks should not surface as MIT).
      const mit = await prisma.task.findFirst({
        where: { status: { in: ["INBOX", "READY"] }, deletedAt: null },
        orderBy: { autoPriority: "asc" },
        select: { title: true },
      }).catch((err): null => {
        logError("brain.operating-rhythm", err, { fn: "executeRhythm.findMIT" });
        return null;
      });

      message =
        `⚡ <b>PEAK BLOCK — 8:00 AM</b>\n\n` +
        `MIT: <b>${mit?.title || "No task set — open Nick and set one NOW"}</b>\n` +
        `${staleLeads > 0 ? `🔴 ${staleLeads} stale leads — call before anything else\n` : ""}` +
        `${pendingCallbacks > 0 ? `📞 ${pendingCallbacks} callbacks waiting\n` : ""}` +
        `\nPeak focus window: NOW until 11am.\n` +
        `Do NOT start system building, planning, or new features.\n` +
        `Revenue actions ONLY.`;
      break;

    case "mid_morning":
      // 11 AM — Mid-morning check
      // 2026-05-27 · revenue cliff alert prepend. By 11am ET on a
      // weekday, zero revenue + zero jobs is the single highest-
      // signal operational anomaly · means dead payment terminal,
      // closed shop, or down bridge. Pre-fix the mid-morning ping
      // just rendered "$0 (0 jobs)" buried in the metric line · no
      // alarm. Now: red banner at the top so the eye lands on it.
      // Weekends skipped (revenue legitimately zero).
      {
        const dayOfWeek = new Date().getDay(); // 0=Sun, 6=Sat (UTC OK · close enough at 11am ET)
        const isWeekday = dayOfWeek !== 0 && dayOfWeek !== 6;
        const cliffBanner =
          isWeekday && todayRevenue === 0 && todayJobCount === 0
            ? `🔴 <b>ZERO REVENUE — no jobs logged today</b>\nCheck payment terminal · shop open? · bridge alive?\n\n`
            : "";

        message =
          cliffBanner +
          `📊 <b>MID-MORNING CHECK — 11:00 AM</b>\n\n` +
          `Revenue: <b>$${todayRevenue.toLocaleString()}</b> (${todayJobCount} jobs)\n` +
          `${staleLeads > 0 ? `🔴 ${staleLeads} stale leads STILL waiting\n` : "✅ No stale leads\n"}` +
          `${pendingCallbacks > 0 ? `📞 ${pendingCallbacks} callbacks\n` : ""}` +
          `Tasks: ${openLoops} | Commitments: ${commitments}\n` +
          `\n1 hour of peak focus left. Most important call to make?`;
      }
      break;

    case "operations":
      // 2 PM — Operations shift
      message =
        `🔧 <b>OPERATIONS SHIFT — 2:00 PM</b>\n\n` +
        `Revenue: <b>$${todayRevenue.toLocaleString()}</b>\n` +
        `${staleLeads > 0 ? `🔴 ${staleLeads} leads going cold — CALL NOW\n` : ""}` +
        `${pendingCallbacks > 0 ? `📞 ${pendingCallbacks} callbacks — return before 4pm\n` : ""}` +
        `\nAdderall is fading. Operations mode:\n` +
        `• Return callbacks\n` +
        `• Follow up on estimates\n` +
        `• Admin tasks\n` +
        `• Do NOT start creative work or planning`;
      break;

    case "pre_close":
      // 5 PM — Pre-close
      // v10.0.46 — replaced dead `Promise.resolve(0)` placeholders
      // with real DAILY-task progress query. Pre-fix the 5pm
      // Telegram always rendered "Habits: 0/0" — the placeholders
      // were lying like the queryNick fields fixed in v10.0.42.
      // Daily tasks completed today vs total daily tasks loaded.
      const dailyTasksToday = await prisma.task.findMany({
        where: { loopKind: "DAILY", status: { not: "ARCHIVED" }, deletedAt: null },
        select: { lastCompletedAt: true },
      }).catch((err): Array<{ lastCompletedAt: Date | null }> => {
        logError("brain.operating-rhythm", err, { fn: "executeRhythm.findDailyTasks" });
        return [];
      });
      const startOfTodayET = new Date(
        new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }) +
          "T00:00:00",
      );
      const habitsDone = dailyTasksToday.filter(
        (t) => t.lastCompletedAt && t.lastCompletedAt >= startOfTodayET,
      ).length;
      const habitsTotal = dailyTasksToday.length;

      message =
        `📋 <b>PRE-CLOSE — 5:00 PM</b>\n\n` +
        `Revenue: <b>$${todayRevenue.toLocaleString()}</b> (${todayJobCount} jobs)\n` +
        `Habits: ${habitsDone}/${habitsTotal}\n` +
        `${todayScore == null ? "⚠️ Score NOT logged\n" : `Score: ${todayScore}/10\n`}` +
        `Tasks: ${openLoops} | Commitments: ${commitments}\n` +
        `\nBefore leaving:\n` +
        `• Log your score if not done\n` +
        `• Clear callbacks\n` +
        `• Set tomorrow's MIT`;
      break;

    // 2026-05-27 · "shutdown" 9pm slot retired · proactive-push
    // evening slot (1 UTC = 9pm ET) already fires an energy-aware
    // shutdown nudge with per-day dedup. This case is unreachable
    // because getCurrentSlot() no longer returns "shutdown" — kept
    // the surrounding switch shape exhaustive on RhythmSlot.
  }

  if (message) {
    // 2026-05-27 · dedup guard. Check BEFORE send · skip + return if
    // this slot already fired today. Marker is written AFTER successful
    // send so a transient sendTelegram failure (Telegram outage) leaves
    // the slot eligible for retry on the next cron tick.
    if (await rhythmAlreadyPushed(activeSlot, todayStr)) {
      return { slot: activeSlot, sent: false, message: "already_sent_today" };
    }

    const sent = await sendTelegram(message).catch((err) => {
      logError("brain.operating-rhythm", err, { fn: "executeRhythm.sendTelegram" });
      return false;
    });
    if (sent) {
      await markRhythmPushed(activeSlot, todayStr);
    }

    // Store rhythm execution
    await prisma.auditEvent.create({
      data: {
        actor: "operating-rhythm",
        eventType: "rhythm_executed",
        detail: `${activeSlot}: ${todayStr}`,
        payload: { slot: activeSlot, revenue: todayRevenue, tasks: openLoops, staleLeads, sent } as never,
      },
    }).catch(() => {});

    // Brain memory for pattern tracking
    await brainMemory.remember(
      "operating_rhythm",
      `rhythm_${activeSlot}_${todayStr}`,
      `RHYTHM [${activeSlot}] ${todayStr}: Revenue $${todayRevenue}, ${staleLeads} stale leads, ${openLoops} tasks, score ${todayScore ? "logged" : "NOT logged"}`,
      "operating-rhythm-engine",
    ).catch((err) => {
      logError("brain.operating-rhythm", err, { fn: "executeRhythm.rememberRhythm" });
    });

    return { slot: activeSlot, sent, message: message.slice(0, 200) };
  }

  return { slot: activeSlot, sent: false, message: message.slice(0, 200) };
}
