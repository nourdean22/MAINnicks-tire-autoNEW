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
import { brainMemory } from "@/lib/brain/memory-manager";
import { today, daysAgo } from "@/lib/utils/datetime";
import { MONTHLY_REVENUE_TARGET } from "@/lib/config/business";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("brain/operating-rhythm");

type RhythmSlot = "peak_start" | "mid_morning" | "operations" | "pre_close" | "shutdown";

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
  if (hour === 21) return "shutdown";
  return null;
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
  }).catch((): null => null);

  let rhythmEnabled = true; // Default on
  if (flag?.value) {
    try {
      const flags = JSON.parse(flag.value);
      if (flags.adhd_operating_rhythm === false) rhythmEnabled = false;
    } catch {}
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
  type ShopJob = { totalRevenue?: number };
  const [todayScore, openLoops, commitments, jobsRes, staleLeadsRes, callbacksRes] = await Promise.all([
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
      .catch((): null => null),
    prisma.task.count({ where: { status: { in: ["INBOX", "READY", "DOING"] } } }).catch((): number => 0),
    prisma.commitment.count({ where: { status: { in: ["active", "in_progress"] } } }).catch((): number => 0),
    queryNick<{ jobs: ShopJob[] }>("jobs_today").catch(() => ({ error: "fetch failed" })),
    queryNick<{ count: number }>("stale_leads_count").catch(() => ({ error: "fetch failed" })),
    queryNick<{ count: number }>("pending_callbacks_count").catch(() => ({ error: "fetch failed" })),
  ]);

  // Unwrap query results — shape is `{ data, query, timestamp }` on
  // success or `{ error }` on failure. On failure we degrade
  // gracefully to zeros (warn-logged via structured logger so
  // /system/errors surfaces persistent bridge failures with surface
  // attribution).
  const recentJobs: ShopJob[] =
    "data" in jobsRes && Array.isArray((jobsRes as { data?: { jobs?: unknown } }).data?.jobs)
      ? ((jobsRes as { data: { jobs: ShopJob[] } }).data.jobs ?? [])
      : [];
  if ("error" in jobsRes) {
    log.warn("bridge_query_failed", { query: "jobs_today", error: jobsRes.error });
  }
  const staleLeads =
    "data" in staleLeadsRes
      ? Number((staleLeadsRes as { data?: { count?: number } }).data?.count ?? 0)
      : 0;
  if ("error" in staleLeadsRes) {
    log.warn("bridge_query_failed", { query: "stale_leads_count", error: staleLeadsRes.error });
  }
  const pendingCallbacks =
    "data" in callbacksRes
      ? Number((callbacksRes as { data?: { count?: number } }).data?.count ?? 0)
      : 0;
  if ("error" in callbacksRes) {
    log.warn("bridge_query_failed", { query: "pending_callbacks_count", error: callbacksRes.error });
  }

  let todayRevenue = 0;
  for (const j of recentJobs) todayRevenue += Number(j.totalRevenue ?? 0);
  const todayJobCount = recentJobs.length;

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
      }).catch((): null => null);

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
      message =
        `📊 <b>MID-MORNING CHECK — 11:00 AM</b>\n\n` +
        `Revenue: <b>$${todayRevenue.toLocaleString()}</b> (${todayJobCount} jobs)\n` +
        `${staleLeads > 0 ? `🔴 ${staleLeads} stale leads STILL waiting\n` : "✅ No stale leads\n"}` +
        `${pendingCallbacks > 0 ? `📞 ${pendingCallbacks} callbacks\n` : ""}` +
        `Tasks: ${openLoops} | Commitments: ${commitments}\n` +
        `\n1 hour of peak focus left. Most important call to make?`;
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
      }).catch((): Array<{ lastCompletedAt: Date | null }> => []);
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

    case "shutdown":
      // 9 PM — Shutdown ritual
      // Check for evening commitments pattern
      const eveningCommitments = await prisma.commitment.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(21, 0, 0, 0)),
          },
        },
      }).catch(() => 0);

      const recentEveningCommitments = await prisma.commitment.findMany({
        where: {
          createdAt: {
            gte: daysAgo(14),
          },
          status: { in: ["broken", "abandoned"] },
          deletedAt: null,
        },
        select: { createdAt: true },
      }).catch((): Array<{ createdAt: Date }> => []);

      const eveningAbandoned = recentEveningCommitments.filter(c => {
        const hour = new Date(c.createdAt).getHours();
        return hour >= 21;
      }).length;

      message =
        `🌙 <b>SHUTDOWN RITUAL — 9:00 PM</b>\n\n` +
        `${!todayScore ? "⚠️ SCORE NOT LOGGED — do it NOW (30 seconds)\n\n" : ""}` +
        `Today: $${todayRevenue.toLocaleString()} revenue\n` +
        `${openLoops > 5 ? `⚠️ ${openLoops} active tasks — too many. Close 2 tomorrow morning.\n` : ""}` +
        `\n<b>Rules for tonight:</b>\n` +
        `❌ No new projects\n` +
        `❌ No new commitments\n` +
        `❌ No financial decisions\n` +
        `✅ Log your score\n` +
        `✅ Plan tomorrow's MIT\n` +
        `✅ Phone in another room by 10:30pm` +
        `${eveningAbandoned >= 2 ? `\n\n⚠️ You've abandoned ${eveningAbandoned} commitments made after 9pm in the last 2 weeks. Your night brain lies to you. Write it down, we evaluate at 9am.` : ""}`;
      break;
  }

  if (message) {
    await sendTelegram(message).catch(() => {});

    // Store rhythm execution
    await prisma.auditEvent.create({
      data: {
        actor: "operating-rhythm",
        eventType: "rhythm_executed",
        detail: `${activeSlot}: ${todayStr}`,
        payload: { slot: activeSlot, revenue: todayRevenue, tasks: openLoops, staleLeads } as any,
      },
    }).catch(() => {});

    // Brain memory for pattern tracking
    await brainMemory.remember(
      "operating_rhythm",
      `rhythm_${activeSlot}_${todayStr}`,
      `RHYTHM [${activeSlot}] ${todayStr}: Revenue $${todayRevenue}, ${staleLeads} stale leads, ${openLoops} tasks, score ${todayScore ? "logged" : "NOT logged"}`,
      "operating-rhythm-engine",
    ).catch(() => {});
  }

  return { slot: activeSlot, sent: !!message, message: message.slice(0, 200) };
}
