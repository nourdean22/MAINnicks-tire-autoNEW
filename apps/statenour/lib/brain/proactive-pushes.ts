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

/** Wave-3 (2026-07-29): every FIRED proactive push lands in the outcome
 *  ledger so delivery coverage + actionable-rate become measurable
 *  (recordShown dedups identical summaries within 24h). Fire-and-forget —
 *  a ledger failure must never block the push path. */
async function recordProactiveShown(slot: string, text: string): Promise<void> {
  try {
    const { recordShown } = await import("@/lib/services/outcome-ledger");
    await recordShown({
      kind: "proactive_push",
      sourceEngine: `proactive-${slot}`,
      summary: text,
      shownSurface: "telegram",
    });
  } catch {
    // recordShown already logs; belt-and-suspenders so the push path
    // can never be broken by ledger bookkeeping.
  }
}
import { logger as rootLogger } from "@/lib/logger";
import { today } from "@/lib/utils/datetime";
import { getTodaysAnticipated } from "@/lib/brain/anticipated-questions";
import { getNickCurrentConcerns } from "@/lib/brain/session-distiller";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("brain/proactive-pushes");

export type PushSlot = "morning" | "afternoon" | "evening" | "approvals_nudge";

export interface PushSource {
  id?: string;
  category:
    | "journal"
    | "body"
    | "task"
    | "goal"
    | "concern"
    | "anticipated_question"
    | "previous_push"
    | "system_context"
    | "unknown";
  title: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  href?: string;
}

export interface PushResult {
  kind: "live";
  slot: PushSlot;
  fired: boolean;
  reason: string;
  text?: string;
}

export interface PushPreview {
  kind: "preview";
  slot: PushSlot;
  nowIso: string;
  timezone: string;
  dryRun: true;
  wouldSend: boolean;
  wouldSkip: boolean;
  reason: string;
  messageText?: string;
  messagePreviewSafe?: string;
  dedupKey?: string;
  dedupBlocked: boolean;
  quietHoursBlocked: boolean;
  rateLimitBlocked: boolean;
  sourceFunction: string;
  riskFlags: string[];
  nextSafeStep: string;
  sources: PushSource[];
}

export interface PushSkip {
  kind: "skip";
  slot?: PushSlot;
  skipped: true;
  reason: string;
}

/**
 * Idempotency · prevent duplicate pushes on cron retries. Marker
 * lives in BrainMemory with a per-day key so multiple fires of the
 * same slot on the same day are no-ops.
 */
async function markPushSent(slot: PushSlot, dateKey: string): Promise<void> {
  await prisma.brainMemory.upsert({
    where: { category_key: { category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT, key: `${slot}_${dateKey}` } },
    create: {
      category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT,
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
    where: { category_key: { category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT, key: `${slot}_${dateKey}` } },
    select: { id: true },
  }).catch((err) => {
    logError("brain.proactive-pushes", err, { fn: "alreadyPushed" });
    return null;
  });
  return row !== null;
}

/**
 * Get today's body entry for the energy-aware evening push.
 * Returns null when nothing logged today · downstream gracefully
 * degrades to a generic evening shutdown nudge.
 */
async function getTodayBody(options?: { now?: Date }): Promise<{ id: number; sleepHours?: number | null; energy?: number | null } | null> {
  const dateStr = options?.now
    ? options.now.toLocaleDateString("en-CA", { timeZone: "America/New_York" })
    : today();
  const row = await prisma.bodyTracking.findUnique({
    where: { date: dateStr },
    select: { id: true, sleepHours: true, energy: true },
  }).catch((err) => {
    logError("brain.proactive-pushes", err, { fn: "getTodayBody" });
    return null;
  });
  return row;
}

/**
 * Morning push (8am ET) · anticipated question + suggested ask.
 * Pulls the top question from getTodaysAnticipated() and sends it
 * as a one-line Telegram prompt. Operator can tap-to-open chat.
 */
export async function fireMorningPush(options?: { dryRun?: boolean; now?: Date }): Promise<PushResult | PushPreview> {
  const now = options?.now ?? new Date();
  const dateKey = options?.now
    ? options.now.toLocaleDateString("en-CA", { timeZone: "America/New_York" })
    : today();

  const isDup = await alreadyPushed("morning", dateKey);
  const set = await getTodaysAnticipated().catch((err) => {
    logError("brain.proactive-pushes", err, { fn: "fireMorningPush.getAnticipated" });
    return null;
  });
  const top = set?.questions?.[0];
  
  const pendingApprovalsCount = await prisma.approvalRequest.count({
    where: { status: "pending_approval" },
  }).catch((err) => {
    logError("brain.proactive-pushes", err, { fn: "fireMorningPush.countApprovals" });
    return 0;
  });

  const hasContent = !!top || pendingApprovalsCount > 0;
  
  const skipReason = isDup 
    ? "already_pushed_today" 
    : (!hasContent ? "no_morning_content" : "");

  let text = top
    ? `☀️ <b>Morning · Nick's pick</b>\n\n` +
      `Today you'll likely want to know:\n` +
      `<i>"${top.question}"</i>\n\n` +
      `Tap to ask Nick · already warmed.`
    : "";

  if (pendingApprovalsCount > 0) {
    if (text) {
      text += `\n\n⚠️ You have ${pendingApprovalsCount} action(s) waiting in your System Approval Queue.`;
    } else {
      text = `☀️ <b>Morning Update</b>\n\n` +
        `⚠️ You have ${pendingApprovalsCount} action(s) waiting in your System Approval Queue.`;
    }
  }

  if (options?.dryRun) {
    const etHour = parseInt(
      now.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "America/New_York" }),
      10,
    );
    const quietHoursBlocked = etHour >= 0 && etHour <= 5;

    const riskFlags = ["preview_only", "live_send_disabled"];
    if (isDup) riskFlags.push("already_sent_today");
    if (!hasContent) riskFlags.push("empty_message", "context_missing");
    if (quietHoursBlocked) riskFlags.push("quiet_hours_overnight");

    // 2026-06-10 · the set is keyed to its BUILD day (evening fan-out),
    // so the morning preview must fall back to yesterday's key for
    // source attribution — same fallback getTodaysAnticipated applies.
    // (Yesterday computed inline, NY timezone, matching
    // anticipated-questions.ts yesterdayKey().)
    const yesterdayDateKey = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    const memoryRow =
      (await prisma.brainMemory.findUnique({
        where: { category_key: { category: "anticipated_question", key: `anticipated_${dateKey}` } },
        select: { id: true },
      }).catch((err) => {
        logError("brain.proactive-pushes", err, { fn: "fireMorningPush.findMemoryToday" });
        return null;
      })) ??
      (await prisma.brainMemory.findUnique({
        where: { category_key: { category: "anticipated_question", key: `anticipated_${yesterdayDateKey}` } },
        select: { id: true },
      }).catch((err) => {
        logError("brain.proactive-pushes", err, { fn: "fireMorningPush.findMemoryYesterday" });
        return null;
      }));

    const sources: PushSource[] = [];
    if (top) {
      const qConf = top.confidence ?? 1;
      const confidenceStr: "high" | "medium" | "low" = 
        qConf >= 0.7 ? "high" : (qConf >= 0.4 ? "medium" : "low");
      
      sources.push({
        id: memoryRow?.id,
        category: "anticipated_question",
        title: "Anticipated Question",
        summary: `Top predicted question: "${top.question}"`,
        confidence: confidenceStr,
        reason: "Calculated from past 7 days user chats, decisions, and commitments.",
        href: "/brain?tab=board",
      });
    } else {
      sources.push({
        category: "system_context",
        title: "Anticipated Question Fallback",
        summary: "No anticipated question set found for today.",
        confidence: "medium",
        reason: "No active anticipated questions predicted by the nightly background agent.",
      });
    }

    return {
      kind: "preview",
      slot: "morning",
      nowIso: now.toISOString(),
      timezone: "America/New_York",
      dryRun: true,
      wouldSend: !skipReason && !quietHoursBlocked,
      wouldSkip: !!skipReason || quietHoursBlocked,
      reason: skipReason || (quietHoursBlocked ? "quiet_hours_overnight" : "eligible"),
      messageText: text || undefined,
      messagePreviewSafe: text || undefined,
      dedupKey: `morning_${dateKey}`,
      dedupBlocked: isDup,
      quietHoursBlocked,
      rateLimitBlocked: false,
      sourceFunction: "fireMorningPush",
      riskFlags,
      nextSafeStep: "Verify preview text looks appropriate.",
      sources,
    };
  }

  // Live flow
  if (isDup) {
    return { kind: "live", slot: "morning", fired: false, reason: "already_pushed_today" };
  }
  if (!hasContent) {
    return { kind: "live", slot: "morning", fired: false, reason: "no_anticipated_set" };
  }

  const ok = await sendTelegram(text).catch((err) => {
    logError("brain.proactive-pushes", err, { fn: "fireMorningPush.sendTelegram" });
    return false;
  });
  if (ok) {
    await markPushSent("morning", dateKey);
    await recordProactiveShown("morning", text);
  }
  return {
    kind: "live",
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
export async function fireAfternoonPush(options?: { dryRun?: boolean; now?: Date }): Promise<PushResult | PushPreview> {
  const now = options?.now ?? new Date();
  const dateKey = options?.now
    ? options.now.toLocaleDateString("en-CA", { timeZone: "America/New_York" })
    : today();

  const isDup = await alreadyPushed("afternoon", dateKey);
  const concerns = await getNickCurrentConcerns().catch((err) => {
    logError("brain.proactive-pushes", err, { fn: "fireAfternoonPush.getConcerns" });
    return null;
  });
  const top = concerns?.threads?.[0];
  const hasContent = !!top;
  
  const skipReason = isDup 
    ? "already_pushed_today" 
    : (!hasContent ? "no_open_threads" : "");

  let text = "";
  if (top) {
    const ageH = Math.round((now.getTime() - new Date(top.sourceLastAt).getTime()) / 3600_000);
    const ageStr = ageH < 24 ? `${ageH}h` : `${Math.round(ageH / 24)}d`;
    const mark = top.kind === "followup" ? "→" : "?";
    text =
      `🎯 <b>Open thread · ${ageStr} old</b>\n\n` +
      `${mark} ${top.text}\n\n` +
      `Tap to pick it back up.`;
  }

  if (options?.dryRun) {
    const etHour = parseInt(
      now.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "America/New_York" }),
      10,
    );
    const quietHoursBlocked = etHour >= 0 && etHour <= 5;

    const riskFlags = ["preview_only", "live_send_disabled"];
    if (isDup) riskFlags.push("already_sent_today");
    if (!hasContent) riskFlags.push("empty_message", "context_missing");
    if (quietHoursBlocked) riskFlags.push("quiet_hours_overnight");

    const memoryRow = await prisma.brainMemory.findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.NICK_CURRENT_CONCERNS, key: "current" } },
      select: { id: true },
    }).catch((err) => {
      logError("brain.proactive-pushes", err, { fn: "fireAfternoonPush.findMemory" });
      return null;
    });

    const sources: PushSource[] = [];
    if (top) {
      sources.push({
        id: top.sourceConversationId || memoryRow?.id,
        category: "concern",
        title: "Active Concern Thread",
        summary: `Distilled open concern: "${top.text}"`,
        confidence: "high",
        reason: "Unresolved question or follow-up from past chat distillations.",
        href: top.sourceConversationId ? `/chat?cid=${top.sourceConversationId}` : undefined,
      });
    } else {
      sources.push({
        category: "system_context",
        title: "Concern Thread Fallback",
        summary: "No unresolved concerns found in history.",
        confidence: "medium",
        reason: "No open threads were identified in recent session distillations.",
      });
    }

    return {
      kind: "preview",
      slot: "afternoon",
      nowIso: now.toISOString(),
      timezone: "America/New_York",
      dryRun: true,
      wouldSend: !skipReason && !quietHoursBlocked,
      wouldSkip: !!skipReason || quietHoursBlocked,
      reason: skipReason || (quietHoursBlocked ? "quiet_hours_overnight" : "eligible"),
      messageText: text || undefined,
      messagePreviewSafe: text || undefined,
      dedupKey: `afternoon_${dateKey}`,
      dedupBlocked: isDup,
      quietHoursBlocked,
      rateLimitBlocked: false,
      sourceFunction: "fireAfternoonPush",
      riskFlags,
      nextSafeStep: "Verify preview text looks appropriate.",
      sources,
    };
  }

  // Live flow
  if (isDup) {
    return { kind: "live", slot: "afternoon", fired: false, reason: "already_pushed_today" };
  }
  if (!hasContent) {
    return { kind: "live", slot: "afternoon", fired: false, reason: "no_open_threads" };
  }

  const ok = await sendTelegram(text).catch((err) => {
    logError("brain.proactive-pushes", err, { fn: "fireAfternoonPush.sendTelegram" });
    return false;
  });
  if (ok) {
    await markPushSent("afternoon", dateKey);
    await recordProactiveShown("afternoon", text);
  }
  return {
    kind: "live",
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
export async function fireEveningPush(options?: { dryRun?: boolean; now?: Date }): Promise<PushResult | PushPreview> {
  const now = options?.now ?? new Date();
  const dateKey = options?.now
    ? options.now.toLocaleDateString("en-CA", { timeZone: "America/New_York" })
    : today();

  const isDup = await alreadyPushed("evening", dateKey);
  const body = await getTodayBody({ now });
  
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

  if (options?.dryRun) {
    const etHour = parseInt(
      now.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "America/New_York" }),
      10,
    );
    const quietHoursBlocked = etHour >= 0 && etHour <= 5;

    const riskFlags = ["preview_only", "live_send_disabled"];
    if (isDup) riskFlags.push("already_sent_today");
    if (quietHoursBlocked) riskFlags.push("quiet_hours_overnight");
    if (!body) riskFlags.push("body_data_missing", "noisy_or_generic");

    const sources: PushSource[] = [];
    if (body) {
      const sleepStr = typeof body.sleepHours === "number" ? `${body.sleepHours.toFixed(1)}h sleep` : "No sleep logged";
      const energyStr = typeof body.energy === "number" ? `energy ${body.energy}/10` : "No energy logged";
      sources.push({
        id: String(body.id),
        category: "body",
        title: "Daily Health Check-in",
        summary: `${sleepStr}, ${energyStr}`,
        confidence: "high",
        reason: "Determined from logged sleep/energy metrics in operator health check-in.",
        href: "/stats#body",
      });
    } else {
      sources.push({
        category: "system_context",
        title: "Evening Review Ritual",
        summary: "No health check-in logged for today.",
        confidence: "medium",
        reason: "Prompt defaults to standard review checklist when health metrics are missing.",
      });
    }

    return {
      kind: "preview",
      slot: "evening",
      nowIso: now.toISOString(),
      timezone: "America/New_York",
      dryRun: true,
      wouldSend: !isDup && !quietHoursBlocked,
      wouldSkip: isDup || quietHoursBlocked,
      reason: isDup ? "already_pushed_today" : (quietHoursBlocked ? "quiet_hours_overnight" : "eligible"),
      messageText: text,
      messagePreviewSafe: text,
      dedupKey: `evening_${dateKey}`,
      dedupBlocked: isDup,
      quietHoursBlocked,
      rateLimitBlocked: false,
      sourceFunction: "fireEveningPush",
      riskFlags,
      nextSafeStep: "Verify preview text looks appropriate.",
      sources,
    };
  }

  // Live flow
  if (isDup) {
    return { kind: "live", slot: "evening", fired: false, reason: "already_pushed_today" };
  }

  const ok = await sendTelegram(text).catch((err) => {
    logError("brain.proactive-pushes", err, { fn: "fireEveningPush.sendTelegram" });
    return false;
  });
  if (ok) {
    await markPushSent("evening", dateKey);
    await recordProactiveShown("evening", text);
  }
  return {
    kind: "live",
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
export async function fireSlotForCurrentHour(options?: { dryRun?: boolean; now?: Date }): Promise<PushResult | PushPreview | PushSkip> {
  const now = options?.now ?? new Date();
  const etHour = parseInt(
    now.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "America/New_York" }),
    10,
  );
  if (etHour >= 6 && etHour <= 11) {
    log.info("slot_dispatch", { slot: "morning", etHour });
    return fireMorningPush(options);
  }
  if (etHour >= 12 && etHour <= 17) {
    log.info("slot_dispatch", { slot: "afternoon", etHour });
    return fireAfternoonPush(options);
  }
  if (etHour >= 18 && etHour <= 23) {
    log.info("slot_dispatch", { slot: "evening", etHour });
    return fireEveningPush(options);
  }

  if (options?.dryRun) {
    const riskFlags = ["preview_only", "live_send_disabled", "quiet_hours_overnight"];
    return {
      kind: "preview",
      slot: "evening", // fallback placeholder for return contract compatibility
      nowIso: now.toISOString(),
      timezone: "America/New_York",
      dryRun: true,
      wouldSend: false,
      wouldSkip: true,
      reason: `quiet_hours_overnight_${etHour}`,
      dedupBlocked: false,
      quietHoursBlocked: true,
      rateLimitBlocked: false,
      sourceFunction: "fireSlotForCurrentHour",
      riskFlags,
      nextSafeStep: "Wait for active hours (6am - 11pm ET) to preview slot-based pushes.",
      sources: [{
        category: "system_context",
        title: "Overnight Quiet Hours",
        summary: "Quiet hours block active overnight (12am - 5am ET).",
        confidence: "high",
        reason: "Automatic overnight scheduling block.",
      }],
    } as PushPreview;
  }

  return { kind: "skip", skipped: true, reason: `overnight_hour_${etHour}` };
}

/**
 * Check if there are any pending autonomous actions and send a daily nudge
 * via Telegram if any exist. Bounded by quiet hours.
 */
export async function checkAndNudgeApprovals(options?: { dryRun?: boolean; now?: Date }): Promise<PushResult | PushPreview | PushSkip> {
  const now = options?.now ?? new Date();
  const dateKey = options?.now
    ? options.now.toLocaleDateString("en-CA", { timeZone: "America/New_York" })
    : today();

  const etHour = parseInt(
    now.toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "America/New_York" }),
    10,
  );
  const quietHoursBlocked = etHour >= 0 && etHour <= 5;

  const pendingCount = await prisma.autonomousAction.count({
    where: { approval: "pending" },
  });
  const pendingSystemCount = await prisma.approvalRequest.count({
    where: { status: "pending_approval" },
  }).catch((err) => {
    logError("brain.proactive-pushes", err, { fn: "checkAndNudgeApprovals.countApprovals" });
    return 0;
  });

  if (pendingCount === 0 && pendingSystemCount === 0) {
    return { kind: "skip", skipped: true, reason: "no_pending_actions" };
  }

  const isDup = await alreadyPushed("approvals_nudge", dateKey);
  
  let text = `⚖️ <b>Governance · Pending Actions</b>\n\n`;
  if (pendingCount > 0) {
    text += `There are <b>${pendingCount}</b> autonomous action(s) pending approval.\n`;
  }
  if (pendingSystemCount > 0) {
    text += `There are <b>${pendingSystemCount}</b> tool execution(s) pending approval.\n`;
  }
  text += `\nTap to review & resolve.`;

  if (quietHoursBlocked) {
    if (options?.dryRun) {
      return {
        kind: "preview",
        slot: "approvals_nudge",
        nowIso: now.toISOString(),
        timezone: "America/New_York",
        dryRun: true,
        wouldSend: false,
        wouldSkip: true,
        reason: `quiet_hours_overnight_${etHour}`,
        dedupBlocked: isDup,
        quietHoursBlocked: true,
        rateLimitBlocked: false,
        sourceFunction: "checkAndNudgeApprovals",
        riskFlags: ["quiet_hours_overnight"],
        nextSafeStep: "Wait for active hours (6am - 11pm ET) to nudge.",
        sources: [{
          category: "system_context",
          title: "Pending Approvals Queue",
          summary: `${pendingCount} actions, ${pendingSystemCount} tool requests pending`,
          confidence: "high",
          reason: "Active count of actions waiting for operator approval.",
        }],
      } as unknown as PushPreview;
    }
    return { kind: "skip", skipped: true, reason: `quiet_hours_overnight_${etHour}` };
  }

  if (options?.dryRun) {
    return {
      kind: "preview",
      slot: "approvals_nudge",
      nowIso: now.toISOString(),
      timezone: "America/New_York",
      dryRun: true,
      wouldSend: !isDup,
      wouldSkip: isDup,
      reason: isDup ? "already_nudged_today" : "eligible",
      messageText: text,
      messagePreviewSafe: text,
      dedupKey: `approvals_nudge_${dateKey}`,
      dedupBlocked: isDup,
      quietHoursBlocked: false,
      rateLimitBlocked: false,
      sourceFunction: "checkAndNudgeApprovals",
      riskFlags: isDup ? ["already_sent_today"] : [],
      nextSafeStep: "Verify preview text looks appropriate.",
      sources: [{
        category: "system_context",
        title: "Pending Approvals Queue",
        summary: `${pendingCount} actions, ${pendingSystemCount} tool requests pending`,
        confidence: "high",
        reason: "Active count of actions waiting for operator approval.",
      }],
    } as unknown as PushPreview;
  }

  if (isDup) {
    return { kind: "live", slot: "approvals_nudge", fired: false, reason: "already_nudged_today" };
  }

  const ok = await sendTelegram(text).catch((err) => {
    logError("brain.proactive-pushes", err, { fn: "checkAndNudgeApprovals.sendTelegram" });
    return false;
  });
  if (ok) await markPushSent("approvals_nudge", dateKey);
  return {
    kind: "live",
    slot: "approvals_nudge",
    fired: ok,
    reason: ok ? "sent" : "telegram_failed",
    text: ok ? text : undefined,
  };
}

/**
 * AG-41 · hourly due-check for /remind reminders. The daily
 * task-resurface sweep (mega-morning) is the backstop for ALL snoozed
 * tasks, but a "/remind in 2h" that fires next morning is a broken
 * promise — so this narrower check runs on the hourly proactive-push
 * cron and only touches ⏰-prefixed reminder tasks.
 *
 * Idempotency is two-layer: the snoozedUntil-null write is the primary
 * lock (same as task-resurface — a second pass no longer matches the
 * query), and a per-task BrainMemory marker (remind_<taskId>) guards
 * the crash window between send and write.
 */
export async function fireDueReminders(): Promise<{ fired: number; reason: string }> {
  const now = new Date();
  const due = await prisma.task
    .findMany({
      where: {
        status: "WAITING",
        snoozedUntil: { not: null, lte: now },
        title: { startsWith: "⏰" },
        deletedAt: null,
      },
      select: { id: true, title: true },
      take: 25,
    })
    .catch((err): Array<{ id: string; title: string }> => {
      logError("brain.proactive-pushes", err, { fn: "fireDueReminders.query" });
      return [];
    });
  if (due.length === 0) return { fired: 0, reason: "none_due" };

  const dedupKeys = due.map((t) => `remind_${t.id}`);
  const alreadySent = await prisma.brainMemory
    .findMany({
      where: { category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT, key: { in: dedupKeys } },
      select: { key: true },
    })
    .catch((err): Array<{ key: string }> => {
      logError("brain.proactive-pushes", err, { fn: "fireDueReminders.dedup" });
      return [];
    });
  const sentKeys = new Set(alreadySent.map((r) => r.key));
  const fresh = due.filter((t) => !sentKeys.has(`remind_${t.id}`));
  if (fresh.length === 0) return { fired: 0, reason: "all_deduped" };

  // One batched line, never per-task spam (AG-18 rule).
  const lines = fresh.slice(0, 10).map((t) => `• ${t.title.replace(/^⏰\s*/, "").slice(0, 80)}`);
  const extra = fresh.length > 10 ? `\n…and ${fresh.length - 10} more` : "";
  const ok = await sendTelegram(`⏰ <b>Reminder</b>\n\n${lines.join("\n")}${extra}`).catch((err) => {
    logError("brain.proactive-pushes", err, { fn: "fireDueReminders.sendTelegram" });
    return false;
  });
  if (!ok) return { fired: 0, reason: "telegram_failed" }; // still WAITING → next hour retries

  const ids = fresh.map((t) => t.id);
  await prisma.task
    .updateMany({
      where: { id: { in: ids } },
      data: { status: "READY", snoozedUntil: null, lastTouchedAt: now },
    })
    .catch((err) => {
      logError("brain.proactive-pushes", err, { fn: "fireDueReminders.flip" });
    });
  for (const id of ids) {
    await prisma.brainMemory
      .upsert({
        where: { category_key: { category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT, key: `remind_${id}` } },
        create: {
          category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT,
          key: `remind_${id}`,
          content: `reminder ping sent at ${now.toISOString()}`,
          source: "proactive_push_cron",
          confidence: 1.0,
          expiresAt: new Date(Date.now() + 48 * 3600_000),
        },
        update: { lastSeen: new Date() },
      })
      .catch((err) => {
        logError("brain.proactive-pushes", err, { fn: "fireDueReminders.mark" });
      });
  }
  return { fired: fresh.length, reason: "sent" };
}
