/**
 * SMS Response Parser — Auto-classifies inbound customer SMS
 * Pattern matching for common responses; anything ambiguous or long is
 * flagged for human follow-up (no AI fallback in this path).
 * This module only CLASSIFIES intent — the orchestrator (smsOrchestrator.ts)
 * executes the action and owns opt-out/cancel/confirm. The old executeAutoAction
 * (a second, divergent engine with $29.99 oil etc.) was retired 2026-07-21.
 */

import { createLogger } from "../lib/logger";

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
  // ─── Revocation FIRST ───
  // PATTERNS is first-hit, so the order is the policy. Until 2026-09-23 this
  // block sat after the confirm, cancel and decline rules: "STOP. Cancel all
  // texts" matched `\bcancel\b`, the orchestrator CANCELLED the booking and
  // no opt-out was recorded; "Stop texting me, too expensive" became a
  // declined estimate. A reply that revokes consent is honoured before
  // anything else in it is acted on (47 CFR 64.1200(a)(10): any reasonable
  // means). Missing a real opt-out is the worse error.
  //
  // Unsubscribe — STOP/END/QUIT/UNSUBSCRIBE are the CTIA standard opt-out
  // keywords. CANCEL is intentionally excluded: for an auto shop a lone
  // "cancel" means cancel-my-appointment (matched below), not opt-out-of-
  // all-SMS. Inbound SMS over the F25e gateway gets no carrier-level
  // opt-out handling, so this app must catch these keywords itself.
  // `revoke` added 2026-08-09: it was already in the SQL opt-out index (so the
  // customer WAS suppressed within the 5-minute cache window) but not here, so
  // the live path produced no unsubscribe action, no compliance row and no
  // confirmation reply. This regex is the one the production webhooks actually
  // reach — smsResponseJobs -> smsOrchestrator -> parseSmsResponse.
  //
  // Visit carve-outs (#2587): "Stop by around 3?", "stop in tomorrow", "End of
  // the day works" are visits, not revocations, and go to a person. They are
  // SAME-LINE only (`[ \t]+`, never `\s+`, which spans a newline and let
  // "STOP" + a line starting "In the future..." escape), and "stop at" /
  // "stop off" / "end of" are carved out only when a visit clearly follows,
  // so "Stop at once", "stop off my list" and "End of discussion" unsubscribe.
  { pattern: /^\s*(stop(?![ \t]+(by|in|over)\b)(?![ \t]+at[ \t]+(\d|(around|about|noon|lunch|the|your|ur|my|after|before)\b))(?![ \t]+off[ \t]+(at|on|by|in|after|before)\b)|stopall|unsubscribe|opt[\s-]?out|revoke|end(?![ \t]+up\b)(?![ \t]+of[ \t]+(the[ \t]+)?(day|week|month|year|business|shift|work|today|tomorrow)\b)|quit|remove\s+me)\b/i, intent: "unsubscribe", autoAction: "unsubscribe-customer", confidence: 99 },
  // Plain-English revocation anywhere in the reply: "cancel all texts",
  // "please stop texting me", "no more texts", "don't text me", "take me off
  // your list". Only an explicit object (texts, messages, me, your list) makes
  // cancel/stop/end a revocation here — a bare "cancel" stays an appointment
  // cancel, and anything vaguer falls through to a person. "unsubscribe" /
  // "opt out" mid-message need a subject ("unsubscribe me", "I want to opt
  // out"), so a "Reply STOP to unsubscribe" spam footer is not read as the
  // sender revoking. Curly apostrophes from iOS (U+2019) count.
  { pattern: /\b(stop|cancel|end|quit)[ \t]+(all[ \t]+)?(the[ \t]+|my[ \t]+|your[ \t]+|these[ \t]+|those[ \t]+)?(texts?|text[ \t]+messages?|texting|messages?|messaging|sms)\b|\bstop[ \t]+(texting|messaging|contacting)\b|\bstop[ \t]+sending[ \t]+(me|us|these|those|texts?|messages?)\b|\b(do[ \t]+not|don['\u2019]?t)[ \t]+(text|message|contact|sms)[ \t]+(me|us|this[ \t]+number)\b|\bno[ \t]+more[ \t]+(texts?|text[ \t]+messages?|messages?)\b|\b(remove|take)[ \t]+(me|my[ \t]+number)[ \t]+(off|from)\b|\b(unsubscribe|opt[ \t-]?out)[ \t]+(me|us|this[ \t]+number)\b|\b(want|like|need)[ \t]+to[ \t]+(unsubscribe|opt[ \t-]?out)\b|\bopt[ \t]+me[ \t]+out\b/i, intent: "unsubscribe", autoAction: "unsubscribe-customer", confidence: 95 },

  // Confirmations
  { pattern: /^(yes|y|yep|yeah|yea|ok|okay|sure|confirm|confirmed|sounds good|see you|will be there|on my way)$/i, intent: "confirm", autoAction: "confirm-appointment", confidence: 95 },
  { pattern: /^(yes|y)\b/i, intent: "confirm", autoAction: "confirm-appointment", confidence: 85 },

  // Cancellations.
  //
  // A bare "no" / "nope" is DELIBERATELY NOT here. It used to match — a lone
  // "No" classified as cancel at 95% confidence, above the requiresHuman<80
  // threshold, and BOTH inbound paths (orchestrateSms at smsOrchestrator.ts:827
  // and executeAutoAction here) then ran `UPDATE bookings SET status='cancelled'`
  // + cancelBookingReminders with no confirmation. So a customer with an active
  // booking who answered "No" to ANY message — a confirmation text they meant to
  // reschedule, a cross-sell, anything — had their appointment silently destroyed.
  //
  // "No" is a yes/no answer, not an unambiguous cancel intent. It now falls
  // through to the default (unknown → requiresHuman) so a person reads it in
  // context. Only explicit cancel language auto-cancels.
  { pattern: /^(cancel|need to cancel|can'?t make it|won'?t be there|not coming)$/i, intent: "cancel", autoAction: "cancel-appointment", confidence: 95 },
  { pattern: /\bcancel\b/i, intent: "cancel", autoAction: "cancel-appointment", confidence: 80 },

  // Estimate approvals
  { pattern: /^(approve|approved|go ahead|do it|fix it|go for it|let'?s do it|proceed)$/i, intent: "approve-estimate", autoAction: "approve-estimate", confidence: 95 },

  // Estimate declines
  { pattern: /^(decline|pass|too much|too expensive|no thanks|not right now|can'?t afford)$/i, intent: "decline-estimate", autoAction: "flag-for-followup", confidence: 85 },
  { pattern: /too (much|expensive|high)/i, intent: "decline-estimate", autoAction: "flag-for-followup", confidence: 80 },

  // Reschedule hints
  { pattern: /reschedule|different (time|day|date)|move (my|the) appointment|change (time|date)/i, intent: "reschedule", autoAction: "flag-for-followup", confidence: 85 },

  // Price/quote questions — "how much for brakes", "what do you charge for oil change"
  { pattern: /how much|what.*(charge|cost|price)|quote.*(for|on)|price.*(for|on|of)/i, intent: "question", autoAction: "auto-price-response", confidence: 85 },
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
        // Carry the original message for auto-actions that need it:
        // price questions (service detection) + opt-outs (compliance log).
        ...(p.autoAction === "auto-price-response"
          ? { extractedData: { question: trimmed } }
          : p.autoAction === "unsubscribe-customer"
            ? { extractedData: { message: trimmed } }
            : {}),
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
