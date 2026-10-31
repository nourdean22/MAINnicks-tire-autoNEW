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
import { liveApprovalRequestWhere } from "@/lib/automation/live-decisions";
import { sendTelegram } from "@/lib/services/telegram";

/**
 * Ledger the push, then send it WITH a usefulness control.
 *
 * ★★★ WHY THIS REPLACED send-then-ledger. Measured 2026-09-18:
 * `intelligence_outcomes` held 293 rows and SIX labels, the newest from
 * 2026-08-31 — 64 new rows and zero new labels in the preceding fortnight.
 * That was not operator neglect. `recordShown` had 24 callers and
 * `recordOutcome` had TWO, both inside discoveries.ts, so every one of the
 * ~214 proactive_push and daily_brief rows was STRUCTURALLY UNLABELABLE:
 * nothing anywhere could express a verdict on them.
 *
 * ★ An outcome ledger with a writer and no rater measures delivery, not
 *   usefulness — and a usefulness column nobody can write is indistinguishable
 *   from one nobody cares about. The fix is an affordance, not a reminder.
 *
 * ⚠ ORDER INVERTED ON PURPOSE. This used to send first and ledger after, which
 * meant a ledger failure shipped an unledgered push — and, more to the point,
 * the message could not carry an id that did not exist yet. Telegram caps
 * `callback_data` at 64 bytes, so the BUTTON CARRIES THE LEDGER ID (a ~25-char
 * cuid), not the content; the rating then lands on the exact row by id instead
 * of re-deriving a content hash.
 *
 * ⚠ FAIL-SOFT, BOTH WAYS. The push is the product; the ledger is bookkeeping.
 * If ledgering fails we still send, just without buttons — a nudge the operator
 * cannot rate beats a nudge they never get.
 */
async function sendRatablePush(slot: string, text: string): Promise<boolean> {
  let ledgerId: string | null = null;
  try {
    const { recordShown } = await import("@/lib/services/outcome-ledger");
    ledgerId = await recordShown({
      kind: "proactive_push",
      sourceEngine: `proactive-${slot}`,
      // Dated (bug-hunt 2026-10-02): the evening text is constant, so the 24h
      // content dedup could reuse yesterday's row and its rating buttons.
      summary: `${new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })} · ${text}`,
      shownSurface: "telegram",
    });
  } catch {
    // recordShown already logs; belt-and-suspenders so the push path
    // can never be broken by ledger bookkeeping.
  }

  if (!ledgerId) {
    return await sendTelegram(text).catch((err) => {
      logError("brain.proactive-pushes", err, { fn: `${slot}.sendTelegram` });
      return false;
    });
  }

  try {
    const { sendTelegramWithButtons } = await import("@/lib/services/telegram");
    const { ratingTelegramButtons } = await import("@/lib/services/outcome-rating-affordance");
    // ledgerId is non-null on this path (the plain-send fallback above handles null).
    const res = await sendTelegramWithButtons(text, ratingTelegramButtons(ledgerId) ?? []);
    return res.ok;
  } catch (err) {
    logError("brain.proactive-pushes", err, { fn: `${slot}.sendWithButtons`, ledgerId });
    // Buttons are the enhancement, the nudge is the product.
    return await sendTelegram(text).catch(() => false);
  }
}
import { logger as rootLogger } from "@/lib/logger";
import { today } from "@/lib/utils/datetime";
import { getTodaysAnticipated } from "@/lib/brain/anticipated-questions";
import { getNickCurrentConcerns } from "@/lib/brain/session-distiller";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("brain/proactive-pushes");

export type PushSlot = "morning" | "afternoon" | "evening" | "approvals_nudge" | "tutor";

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
  /** Daily Tutor (W2): rides the morning hour after the morning push; its own claim. */
  tutor?: PushResult | PushPreview;
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
  tutor?: PushResult | PushPreview;
}

export interface PushSkip {
  kind: "skip";
  slot?: PushSlot;
  skipped: true;
  reason: string;
}

/**
 * Claim a push slot BEFORE sending (claim-before-act, audit 08-X1). The marker used to
 * be read, then the push sent, then the marker written: a failed read or two racing
 * runs both read "not sent" and both sent. Now the create on the (category, key)
 * unique index is the compare-and-set: P2002 means another run already holds today's
 * slot, and any other error is "unavailable" so the caller does NOT send (fail closed).
 * The row keeps its 48h TTL and is the "sent today" marker once the send succeeds.
 */
export async function claimPushSlot(key: string, source: string): Promise<"won" | "duplicate" | "unavailable"> {
  try {
    // brain-memory-direct-write: a dedupe marker, not a semantic memory.
    await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT,
        key,
        content: `${key} claimed at ${new Date().toISOString()}`,
        source,
        confidence: 1.0,
        expiresAt: new Date(Date.now() + 48 * 3600_000), // 48h TTL
      },
    });
    return "won";
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === "P2002") return "duplicate";
    logError("brain.proactive-pushes", err, { fn: "claimPushSlot", key });
    return "unavailable";
  }
}

/** Give a claim back after a failed send, so the next tick may retry the slot. */
export async function releasePushSlot(key: string): Promise<void> {
  await prisma.brainMemory
    .deleteMany({ where: { category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT, key } })
    .catch((err) => logError("brain.proactive-pushes", err, { fn: "releasePushSlot", key }));
}

/** Claim the slot, send, release on a failed send. The loser of the claim never sends. */
export async function sendClaimed(
  slot: PushSlot,
  dateKey: string,
  send: () => Promise<boolean>,
): Promise<{ fired: boolean; reason: string }> {
  const key = `${slot}_${dateKey}`;
  const claim = await claimPushSlot(key, "proactive_push_cron");
  if (claim === "duplicate") return { fired: false, reason: "already_pushed_today" };
  if (claim === "unavailable") return { fired: false, reason: "dedupe_unavailable" };
  const ok = await send();
  if (!ok) await releasePushSlot(key);
  return { fired: ok, reason: ok ? "sent" : "telegram_failed" };
}

export async function alreadyPushed(slot: PushSlot, dateKey: string): Promise<boolean> {
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

  // home-pulse W3b (2026-10-31): the approval count is NOT repeated here. The same hourly tick runs
  // checkAndNudgeApprovals from 06:00 ET, which owns that count (autonomous + tool approvals), so the
  // morning push carried it a second time: two Telegrams for one fact.
  const hasContent = !!top;

  const skipReason = isDup
    ? "already_pushed_today"
    : (!hasContent ? "no_morning_content" : "");

  const text = top
    ? `☀️ <b>Morning · Nick's pick</b>\n\n` +
      `Today you'll likely want to know:\n` +
      `<i>"${top.question}"</i>\n\n` +
      `Tap to ask Nick · already warmed.`
    : "";

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
        href: "/chat",
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

  const { fired, reason } = await sendClaimed("morning", dateKey, () => sendRatablePush("morning", text));
  return {
    kind: "live",
    slot: "morning",
    fired,
    reason,
    text: fired ? text : undefined,
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

  const { fired, reason } = await sendClaimed("afternoon", dateKey, () => sendRatablePush("afternoon", text));
  return {
    kind: "live",
    slot: "afternoon",
    fired,
    reason,
    text: fired ? text : undefined,
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
        href: "/stats?tab=body",
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

  const { fired, reason } = await sendClaimed("evening", dateKey, () => sendRatablePush("evening", text));
  return {
    kind: "live",
    slot: "evening",
    fired,
    reason,
    text: fired ? text : undefined,
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
    const morning = await fireMorningPush(options);
    // Daily Tutor (W2, 2026-10-16): after the morning push, never before it.
    // Independent claims: a morning already sent today does not block the tutor.
    const tutor = await import("@/lib/brain/tutor-pack")
      .then(({ fireTutorPush }) => fireTutorPush(options))
      .catch((err) => {
        logError("brain.proactive-pushes", err, { fn: "fireSlotForCurrentHour.tutor" });
        return null;
      });
    log.info("slot_dispatch", { slot: "tutor", etHour, fired: tutor?.kind === "live" ? tutor.fired : null, reason: tutor?.reason });
    return tutor ? { ...morning, tutor } : morning;
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

  // A failed count read is UNKNOWN, never zero: null means "could not read". One throw used to fail this
  // whole cron step (twice, with retries) so the hour's approval count never reached him, and a failed
  // tool-approval read counted as 0 and skipped the nudge as "no pending actions" with no signal.
  const readCount = async (fn: string, read: () => Promise<number>): Promise<number | null> => {
    try {
      return await read();
    } catch (err) {
      log.warn("approvals_nudge_count_unreadable", { fn, err: err instanceof Error ? err.message : String(err) });
      logError("brain.proactive-pushes", err, { fn });
      return null;
    }
  };
  const pendingCount = await readCount("checkAndNudgeApprovals.countActions", () =>
    prisma.autonomousAction.count({ where: { approval: "pending" } }),
  );
  const pendingSystemCount = await readCount("checkAndNudgeApprovals.countApprovals", () =>
    prisma.approvalRequest.count({
      // Live only (lib/automation/live-decisions.ts): an expired request is not waiting on the operator.
      where: liveApprovalRequestWhere(now),
    }),
  );
  const actions = pendingCount ?? 0;
  const tools = pendingSystemCount ?? 0;

  if (actions === 0 && tools === 0) {
    const unreadable = pendingCount === null || pendingSystemCount === null;
    return { kind: "skip", skipped: true, reason: unreadable ? "approval_count_unreadable" : "no_pending_actions" };
  }

  const isDup = await alreadyPushed("approvals_nudge", dateKey);

  let text = `⚖️ <b>Governance · Pending Actions</b>\n\n`;
  if (actions > 0) {
    text += `There are <b>${actions}</b> autonomous action(s) pending approval.\n`;
  }
  if (tools > 0) {
    text += `There are <b>${tools}</b> tool execution(s) pending approval.\n`;
  }
  if (pendingCount === null) text += `Could not read the autonomous action count just now, so some may be waiting too.\n`;
  if (pendingSystemCount === null) text += `Could not read the tool approval count just now, so some may be waiting too.\n`;
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
          summary: `${pendingCount ?? "unknown"} actions, ${pendingSystemCount ?? "unknown"} tool requests pending`,
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
        summary: `${pendingCount ?? "unknown"} actions, ${pendingSystemCount ?? "unknown"} tool requests pending`,
        confidence: "high",
        reason: "Active count of actions waiting for operator approval.",
      }],
    } as unknown as PushPreview;
  }

  if (isDup) {
    return { kind: "live", slot: "approvals_nudge", fired: false, reason: "already_nudged_today" };
  }

  const { fired, reason } = await sendClaimed("approvals_nudge", dateKey, () =>
    sendTelegram(text).catch((err) => {
      logError("brain.proactive-pushes", err, { fn: "checkAndNudgeApprovals.sendTelegram" });
      return false;
    }),
  );
  return {
    kind: "live",
    slot: "approvals_nudge",
    fired,
    reason,
    text: fired ? text : undefined,
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
