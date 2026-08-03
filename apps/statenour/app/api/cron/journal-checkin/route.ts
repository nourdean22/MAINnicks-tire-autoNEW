/**
 * Journal Check-in Cron — Nick proactively reaches out via Telegram.
 *
 * Sends context-aware prompts at different times of day:
 * - Morning (5am slot): "What's the plan today?" + yesterday's open loops
 * - Evening (10pm slot): "How did today go?" + what got done vs planned
 *
 * The prompts are smart — they reference actual data from the system.
 */

import { prisma } from "@/lib/prisma";
import { cronHandler } from "@/lib/utils/http";
import { sendTelegram } from "@/lib/services/telegram";
import { today, toDateString, daysAgo, startOfDayET } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const maxDuration = 30;

export const GET = cronHandler(async (req) => {
  const url = new URL(req.url);
  const slot = url.searchParams.get("slot") || detectSlot();

  // Gather context for smart prompts. Apr 19 · DailyScore retired,
  // replaced with today's DONE-task count + live identity snapshot.
  const [openLoopsRaw, todayDumps, todayDone, identitySnap, unresolvedAlerts] = await Promise.all([
    prisma.task.findMany({
      where: { status: { in: ["INBOX", "READY"] }, deletedAt: null },
      orderBy: [{ autoPriority: "asc" }, { createdAt: "desc" }],
      take: 5,
      select: { title: true, autoPriority: true },
    }),
    prisma.brainDump.count({ where: { date: today(), deletedAt: null } }),
    prisma.task.count({
      where: {
        status: "DONE",
        deletedAt: null,
        updatedAt: {
          // forensic-audit MEDIUM · was setHours(0,0,0,0) = server-local (UTC on
          // Railway) midnight, ~4-5h off Eastern, so the evening check-in
          // counted only the last ~3 hours ("0 tasks done today" every night).
          gte: startOfDayET(),
        },
      },
      // null = read failed — the evening line must say "unavailable",
      // never "0 tasks done today" (2026-07-30 sweep).
    }).catch(() => null),
    prisma.brainMemory
      .findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
        select: { content: true },
      })
      .catch(() => null),
    (async () => {
      const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
      // null = read failed — absence of the drift line must not read as
      // "no drift" when we simply couldn't check.
      const alerts = await getUnresolvedAlerts().catch(() => null);
      return alerts === null ? null : alerts.length;
    })(),
  ]);
  const openLoops = openLoopsRaw.map((t) => ({
    title: t.title,
    priority:
      (t.autoPriority ?? 50) < 20 ? "critical"
      : (t.autoPriority ?? 50) < 40 ? "high"
      : (t.autoPriority ?? 50) < 60 ? "medium"
      : "low",
  }));

  let prompt: string;

  if (slot === "morning") {
    const taskList = openLoops.length > 0
      ? openLoops.map((l) => `  - ${l.priority === "critical" ? "!!" : "-"} ${l.title}`).join("\n")
      : "  No open tasks.";

    const alertLine = unresolvedAlerts === null
      ? `\nDrift-alert check unavailable (read failed).`
      : unresolvedAlerts > 0
        ? `\n${unresolvedAlerts} drift alert${unresolvedAlerts > 1 ? "s" : ""} unresolved.`
        : "";

    prompt =
      `<b>Nick here. Morning check-in.</b>\n\n` +
      `Your open tasks:\n${taskList}${alertLine}\n\n` +
      `What's the plan today? What's the ONE thing that moves the needle?\n\n` +
      `<i>Reply with anything — brain dump, plan, or just how you're feeling. I'll process it all.</i>\n` +
      // Capture wave (audit 2026-07-15) · deep link straight into the
      // prefocused composer (#reflect hash auto-scrolls + focuses).
      `<a href="https://bdnick.info/journal#reflect">Open the composer →</a>`;
  } else {
    // Evening check-in — Apr 19 · DailyScore retired, using live
    // signals (today's DONE count + brain maturity snapshot).
    let maturityLine = "";
    if (identitySnap?.content) {
      try {
        const snap = JSON.parse(identitySnap.content) as { axes: Record<string, { value: number; manual: number | null }> };
        const axes = Object.values(snap.axes ?? {});
        if (axes.length > 0) {
          const avg = Math.round(axes.reduce((s, a) => s + (a.manual ?? a.value), 0) / axes.length);
          maturityLine = `\nBrain maturity: ${avg}/100.`;
        }
      } catch {
        // skip
      }
    }

    const doneLine = todayDone === null
      ? "Done-count unavailable (read failed)."
      : `${todayDone} task${todayDone === 1 ? "" : "s"} done today.`;
    const dumpLine = todayDumps > 0
      ? `${todayDumps} journal entr${todayDumps === 1 ? "y" : "ies"} today.`
      : "No journal entries today.";

    const criticalTasks = openLoops.filter((l) => l.priority === "critical");
    const critLine = criticalTasks.length > 0
      ? `\nCritical still open: ${criticalTasks.map((t) => t.title).join(", ")}`
      : "";

    prompt =
      `<b>Nick. End of day.</b>\n\n` +
      `${doneLine} ${dumpLine}${maturityLine}${critLine}\n\n` +
      `How did today actually go? What got done, what didn't, and what's on your mind?\n\n` +
      `<i>Reply with anything. Short or long — I'll capture it all.</i>\n` +
      `<a href="https://bdnick.info/journal#reflect">Open the composer →</a>`;
  }

  const sent = await sendTelegram(prompt);

  // Log the check-in
  await prisma.auditEvent.create({
    data: {
      actor: "journal_checkin",
      // `sent` was already captured and carried in the payload, but the
      // eventType and detail asserted delivery unconditionally — so
      // /system/events rendered "sent via Telegram" for prompts that never
      // arrived.
      eventType: sent ? "journal_prompt_sent" : "journal_prompt_undelivered",
      detail: sent
        ? `${slot} check-in sent via Telegram`
        : `${slot} check-in NOT delivered (Telegram send failed or unconfigured)`,
      payload: { slot, sent, openLoops: openLoops.length, todayDumps, unresolvedAlerts },
    },
  }).catch(() => {});

  return { slot, sent, openLoops: openLoops.length };
});

function detectSlot(): "morning" | "evening" {
  // v10.0.39 — compute ET hour, not UTC. Pre-fix: `getUTCHours() < 15`
  // mapped UTC 5am → 1am ET (NOT morning) and UTC 10pm → 6pm ET (NOT
  // evening) — slot detection was effectively random across DST
  // transitions and dependent on which UTC hour the cron fired at.
  // Prefer the ?slot=morning|evening URL param when set; fall back
  // to ET hour parsing here as last resort.
  const etHourStr = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
  });
  const etHour = parseInt(etHourStr, 10);
  // 4am-3pm ET = morning slot; everything else = evening.
  return etHour >= 4 && etHour < 15 ? "morning" : "evening";
}
