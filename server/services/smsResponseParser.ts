/**
 * SMS Response Parser — Auto-classifies inbound customer SMS
 * Pattern matching for common responses, Gemini fallback for complex ones.
 * Auto-actions: confirm, cancel, approve estimate, unsubscribe.
 */

import { createLogger } from "../lib/logger";
import { eq, and } from "drizzle-orm";

const log = createLogger("sms-parser");

interface ParsedResponse {
  intent: "confirm" | "cancel" | "reschedule" | "approve-estimate" | "decline-estimate" | "question" | "unsubscribe" | "unknown";
  confidence: number;
  autoAction?: string;
  requiresHuman: boolean;
  extractedData?: Record<string, string>;
}

// ─── Instant pattern matching (no AI needed) ────
const PATTERNS: Array<{ pattern: RegExp; intent: ParsedResponse["intent"]; autoAction: string; confidence: number }> = [
  // Confirmations
  { pattern: /^(yes|y|yep|yeah|yea|ok|okay|sure|confirm|confirmed|sounds good|see you|will be there|on my way)$/i, intent: "confirm", autoAction: "confirm-appointment", confidence: 95 },
  { pattern: /^(yes|y)\b/i, intent: "confirm", autoAction: "confirm-appointment", confidence: 85 },

  // Cancellations
  { pattern: /^(cancel|no|nope|can'?t make it|need to cancel|won'?t be there|not coming)$/i, intent: "cancel", autoAction: "cancel-appointment", confidence: 95 },
  { pattern: /cancel/i, intent: "cancel", autoAction: "cancel-appointment", confidence: 80 },

  // Estimate approvals
  { pattern: /^(approve|approved|go ahead|do it|fix it|go for it|let'?s do it|proceed)$/i, intent: "approve-estimate", autoAction: "approve-estimate", confidence: 95 },

  // Estimate declines
  { pattern: /^(decline|pass|too much|too expensive|no thanks|not right now|can'?t afford)$/i, intent: "decline-estimate", autoAction: "flag-for-followup", confidence: 85 },
  { pattern: /too (much|expensive|high)/i, intent: "decline-estimate", autoAction: "flag-for-followup", confidence: 80 },

  // Unsubscribe
  { pattern: /^(stop|unsubscribe|opt out|remove me)$/i, intent: "unsubscribe", autoAction: "unsubscribe-customer", confidence: 99 },

  // Reschedule hints
  { pattern: /reschedule|different (time|day|date)|move (my|the) appointment|change (time|date)/i, intent: "reschedule", autoAction: "flag-for-followup", confidence: 85 },
];

/**
 * Parse an inbound SMS message and determine customer intent.
 */
export function parseSmsResponse(message: string): ParsedResponse {
  const trimmed = message.trim();

  // Try pattern matching first (fast, no AI)
  for (const p of PATTERNS) {
    if (p.pattern.test(trimmed)) {
      log.info("SMS classified by pattern", { intent: p.intent, confidence: p.confidence, message: trimmed.slice(0, 50) });
      return {
        intent: p.intent,
        confidence: p.confidence,
        autoAction: p.autoAction,
        requiresHuman: p.confidence < 80,
      };
    }
  }

  // Check for question marks (likely a question)
  if (trimmed.includes("?")) {
    return {
      intent: "question",
      confidence: 70,
      autoAction: "flag-for-followup",
      requiresHuman: true,
      extractedData: { question: trimmed },
    };
  }

  // Long messages likely need human review
  if (trimmed.length > 100) {
    return {
      intent: "unknown",
      confidence: 30,
      autoAction: "flag-for-followup",
      requiresHuman: true,
    };
  }

  // Default: unknown
  log.info("SMS could not be auto-classified", { message: trimmed.slice(0, 50) });
  return {
    intent: "unknown",
    confidence: 20,
    autoAction: "flag-for-followup",
    requiresHuman: true,
  };
}

/**
 * Execute the auto-action for a parsed SMS response.
 */
export async function executeAutoAction(parsed: ParsedResponse, phone: string, context?: { bookingId?: number; estimateId?: string }): Promise<{ executed: boolean; action?: string }> {
  if (!parsed.autoAction || parsed.requiresHuman) {
    return { executed: false };
  }

  try {
    const { getDb } = await import("../db");
    const db = await getDb();

    switch (parsed.autoAction) {
      case "confirm-appointment":
        if (context?.bookingId && db) {
          const { bookings } = await import("../../drizzle/schema");
          await db.update(bookings)
            .set({ status: "confirmed" })
            .where(eq(bookings.id, context.bookingId));
          log.info("Auto-confirmed appointment", { bookingId: context.bookingId, phone: phone.slice(-4) });
        }
        return { executed: true, action: "confirm-appointment" };

      case "cancel-appointment":
        if (context?.bookingId && db) {
          const { bookings } = await import("../../drizzle/schema");
          await db.update(bookings)
            .set({ status: "cancelled" })
            .where(eq(bookings.id, context.bookingId));
          // Cancel pending SMS reminders
          const { cancelBookingReminders } = await import("./sms-scheduler");
          await cancelBookingReminders(context.bookingId);
          log.info("Auto-cancelled appointment + reminders", { bookingId: context.bookingId, phone: phone.slice(-4) });
        }
        return { executed: true, action: "cancel-appointment" };

      case "approve-estimate":
        if (context?.estimateId) {
          log.info("Estimate approved via SMS — flagging for shop", { estimateId: context.estimateId, phone: phone.slice(-4) });
          // Notify shop about approval
          const { sendNotification } = await import("../email-notify");
          sendNotification({
            category: "booking",
            subject: `Estimate Approved by Customer (***${phone.slice(-4)})`,
            body: `Customer approved estimate #${context.estimateId} via SMS reply. Please proceed with the repair.`,
          }).catch(() => {});
        }
        return { executed: true, action: "approve-estimate" };

      case "unsubscribe-customer":
        if (db) {
          const { customers } = await import("../../drizzle/schema");
          const normalized = phone.replace(/\D/g, "").slice(-10);
          await db.update(customers)
            .set({ smsOptOut: 1 })
            .where(eq(customers.phone, normalized));
          log.info("Customer opted out of SMS marketing", { phone: phone.slice(-4) });
        }
        return { executed: true, action: "unsubscribe-customer" };

      case "flag-for-followup":
        log.info("Flagged for human follow-up", { phone: phone.slice(-4) });
        return { executed: true, action: "flag-for-followup" };

      default:
        return { executed: false };
    }
  } catch (err) {
    log.error("Auto-action failed", { action: parsed.autoAction, error: err instanceof Error ? err.message : String(err) });
    return { executed: false };
  }
}
