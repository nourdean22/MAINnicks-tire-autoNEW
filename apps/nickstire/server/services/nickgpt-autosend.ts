/**
 * NickGPT Auto-Send Service
 * Automatically responds to low-risk customer messages (e.g. greetings, hours, location)
 * when feature flags are enabled.
 */

import { classifyIntent } from "./classifiers";
import { isEnabled } from "./featureFlags";
import { draftSmsReply } from "./nickgpt-client";
import { getDbTyped, getConversationMessages, addSmsMessage } from "../db";
import { bookings, nickgptDrafts } from "../../drizzle/schema";
import { sendSms } from "../sms";
import { logAdminAction } from "./auditTrail";
import { eq, desc, and, sql } from "drizzle-orm";
import { createLogger } from "../lib/logger";

const log = createLogger("nickgpt-autosend");

export async function handleNickGptAutoSend(
  phone: string,
  body: string,
  conversationId: number
): Promise<{ autoSent: boolean; draft?: string; error?: string }> {
  // 1. Check feature flags
  const autoReplyEnabled = await isEnabled("smart_sms_auto_reply");
  const lowRiskEnabled = await isEnabled("nickgpt_low_risk_autosend_enabled");

  if (!autoReplyEnabled || !lowRiskEnabled) {
    return { autoSent: false, error: "Auto-reply or low-risk auto-send flags disabled" };
  }

  const normalized = phone.replace(/\D/g, "").slice(-10);

  // 2. Classify intent with custom labels tailored for auto-send decision
  const candidateLabels = [
    "asking about hours or location",
    "greeting or hello",
    "asking about brake service",
    "asking about tire prices or sizes",
    "asking about oil change",
    "asking about diagnostic or check engine",
    "asking about appointment scheduling",
    "complaint or negative feedback",
    "opting out of texts"
  ] as const;

  const classification = await classifyIntent(body, { labels: candidateLabels });
  if (!classification.ok) {
    log.warn("Intent classification failed for auto-send check", { error: classification.error });
    return { autoSent: false, error: `Classification failed: ${classification.error}` };
  }

  const { topLabel, topScore } = classification;
  log.info("Auto-send classification", { phoneLast4: normalized.slice(-4), topLabel, topScore });

  // 3. Check if intent is low-risk and confidence is high
  const lowRiskLabels = [
    "asking about hours or location",
    "greeting or hello",
    "asking about brake service",
    "asking about tire prices or sizes",
    "asking about oil change",
    "asking about diagnostic or check engine",
    "asking about appointment scheduling"
  ];
  const CONFIDENCE_THRESHOLD = 0.85;

  if (!lowRiskLabels.includes(topLabel) || topScore < CONFIDENCE_THRESHOLD) {
    log.info("Message is not low-risk or confidence below threshold, skipping auto-send", {
      topLabel,
      topScore,
      threshold: CONFIDENCE_THRESHOLD
    });
    return { autoSent: false };
  }

  // 4. Fetch active booking context
  const db = await getDbTyped();
  let activeBookingCtx: { vehicle: string | null; stage: string; service: string } | undefined = undefined;
  if (db) {
    try {
      const activeBookings = await db.select()
        .from(bookings)
        .where(
          and(
            eq(bookings.phone, normalized),
            sql`${bookings.status} IN ('new', 'confirmed')`
          )
        )
        .orderBy(desc(bookings.createdAt))
        .limit(1);

      if (activeBookings && activeBookings.length > 0) {
        const b = activeBookings[0];
        activeBookingCtx = {
          vehicle: b.vehicle,
          stage: b.stage,
          service: b.service,
        };
      }
    } catch (err) {
      log.warn("Failed to fetch active booking context for auto-send", err);
    }
  }

  // 5. Get conversation context
  let conversationContext: Array<{ role: "user" | "assistant"; content: string }> = [];
  try {
    const dbMessages = await getConversationMessages(conversationId, 10);
    if (dbMessages && dbMessages.length > 0) {
      conversationContext = dbMessages.map((msg: any) => ({
        role: msg.direction === "inbound" ? ("user" as const) : ("assistant" as const),
        content: msg.body,
      }));
    }
  } catch (err) {
    log.warn("Failed to fetch conversation history for auto-send", err);
  }

  // 6. Draft reply
  const draftResult = await draftSmsReply({
    inboundMessage: body,
    conversationContext,
    activeBooking: activeBookingCtx,
  });

  if (!draftResult.ok) {
    log.warn("Draft generation failed for auto-send", { error: draftResult.error });
    return { autoSent: false, error: `Draft generation failed: ${draftResult.error}` };
  }

  const replyText = draftResult.draft.trim();
  if (!replyText) {
    return { autoSent: false, error: "Empty draft generated" };
  }

  // 7. Send the SMS
  const sendResult = await sendSms(normalized, replyText, { via: "shop" });
  if (!sendResult.success) {
    log.warn("Failed to send auto-reply SMS via gateway", { phoneLast4: normalized.slice(-4) });
    return { autoSent: false, error: "SMS sending failed" };
  }

  // 8. Record the outbound message in db
  try {
    await addSmsMessage({
      conversationId,
      direction: "outbound",
      body: replyText,
      twilioSid: sendResult.sid || undefined,
      status: "sent",
    });
  } catch (err) {
    log.error("Failed to add auto-sent SMS message to database", err);
  }

  // 9. Log the draft to nickgpt_drafts with autoSent: true and status: approved
  if (db) {
    try {
      await db.insert(nickgptDrafts).values({
        customerPhone: normalized,
        inboundMessage: body,
        draftReply: replyText,
        intent: topLabel,
        confidence: topScore,
        provider: draftResult.source,
        latencyMs: draftResult.latencyMs,
        status: "approved",
        autoSent: true,
      });
    } catch (err) {
      log.warn("Failed to log auto-sent draft to database", err);
    }
  }

  // 10. Log admin action
  logAdminAction({
    action: "customer.sms_autosend_reply",
    entityType: "sms_conversation",
    entityId: conversationId,
    details: `Auto-sent NickGPT reply to ${normalized} (intent: ${topLabel}): "${replyText.slice(0, 80)}${replyText.length > 80 ? "..." : ""}"`,
    newValue: "sent",
    actor: "NickGPT Auto-Send",
  }).catch(() => {});

  log.info("Auto-sent reply successfully", { phoneLast4: normalized.slice(-4), intent: topLabel });
  return { autoSent: true, draft: replyText };
}
