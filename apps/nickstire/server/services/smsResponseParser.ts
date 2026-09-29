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

// A phrase that LOOKS like a revocation must not win when the customer
// explicitly negates that action. These replies are ambiguous enough that a
// person should read them; auto-opting out would reverse the sender's intent.
//
// Global on purpose (audit-2026-09-29-F3): only the negated SPAN is removed,
// and the revocation rules then read what is left. Until then the test ran on
// the whole message and returned first, so "You guys never stop texting me.
// STOP" went to a person, nothing was recorded, and the texts continued.
// outboundCallCompliance.ts does the same for spoken do-not-call phrases.
const NEGATED_REVOCATION_PATTERN = /\b(?:do[ \t]+not|don['\u2019]?t|never)[ \t]+(?:want[ \t]+to[ \t]+)?(?:stop[ \t]+(?:texting|messaging|contacting)|stop[ \t]+sending[ \t]+(?:me|us)?[ \t]*(?:texts?|messages?)|(?:stop|cancel|end|quit)[ \t]+(?:all[ \t]+)?(?:the[ \t]+|my[ \t]+|your[ \t]+|these[ \t]+|those[ \t]+)?(?:texts?|text[ \t]+messages?|texting|messages?|messaging|sms)|unsubscribe(?:[ \t]+(?:me|us|this[ \t]+number))?|opt[ \t-]?out(?:[ \t]+(?:me|us|this[ \t]+number))?|opt[ \t]+(?:me|us)[ \t]+out|(?:remove|take)[ \t]+(?:me|my[ \t]+number)[ \t]+(?:off|from))\b/gi;

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
  // "STOP" + a line starting "In the future..." escape).
  // "stop at" / "stop off" / "end of" are ALLOW-LISTED since
  // audit-2026-09-29-F3: they unsubscribe only with a revocation continuation
  // ("Stop at once", "stop off my list", "End of discussion"). The old
  // carve-out listed visit words instead, and every time phrase it missed
  // ("Stop at five ok?", "End of September is better") silently unsubscribed.
  // Anything else after them goes to a person.
  { pattern: /^\s*(stop(?![ \t]+(by|in|over)\b)(?![ \t]+at\b(?![ \t]+once\b))(?![ \t]+off\b(?![ \t]+(?:(?:my|your|the|this|ur)[ \t]+)?(?:list|texts?|messages?|sms)\b))|stopall|unsubscribe|opt[\s-]?out|revoke|end(?![ \t]+up\b)(?![ \t]+of\b(?![ \t]+(?:(?:the|this)[ \t]+)?(?:discussion|story|conversation|texts?|messages?)\b))|quit|remove[ \t]+me(?=[ \t]*(?:[.!?]|$)))\b/i, intent: "unsubscribe", autoAction: "unsubscribe-customer", confidence: 99 },
  // A bare keyword as its own sentence or line anywhere in the reply ("You
  // guys never stop texting me. STOP"). END and CANCEL are excluded: "The end."
  // and "Cancel." are not revocations here.
  { pattern: /(?:^|[.!?\n])[ \t]*(?:stop|stopall|stop[ \t]+all|unsubscribe|opt[ \t-]?out|revoke|quit)[ \t]*[.!]*[ \t]*(?=\n|$)/i, intent: "unsubscribe", autoAction: "unsubscribe-customer", confidence: 99 },
  // Plain-English revocation anywhere in the reply: "cancel all texts",
  // "please stop texting me", "no more texts", "don't text me", "take me off
  // your list". Only an explicit object (texts, messages, me, your list) makes
  // cancel/stop/end a revocation here — a bare "cancel" stays an appointment
  // cancel, and anything vaguer falls through to a person. "unsubscribe" /
  // "opt out" mid-message need a subject ("unsubscribe me", "I want to opt
  // out"), so a "Reply STOP to unsubscribe" spam footer is not read as the
  // sender revoking. Curly apostrophes from iOS (U+2019) count.
  // "text" followed by me/us is a request ("cancel text me when you have an
  // opening"), not the object of cancel. "stop texting" is not a revocation
  // when it is a question about us ("Why did you stop texting me?") or the
  // customer talking about themself ("I'll stop texting you").
  { pattern: /\b(stop|cancel|end|quit)[ \t]+(all[ \t]+)?(the[ \t]+|my[ \t]+|your[ \t]+|these[ \t]+|those[ \t]+)?(texts|text(?![ \t]+(?:me|us)\b)|text[ \t]+messages?|texting|messages?|messaging|sms)\b(?<!(?:\bwhy(?:[ \t]+(?:did|do|would)|['\u2019]d)[ \t]+(?:you|u|y['\u2019]?all)|\bI(?:['\u2019]ll|[ \t]+will|['\u2019]m[ \t]+gonna|[ \t]+am[ \t]+going[ \t]+to))[ \t]+stop[ \t]+texting)|\bstop[ \t]+(texting|messaging|contacting)\b(?<!(?:\bwhy(?:[ \t]+(?:did|do|would)|['\u2019]d)[ \t]+(?:you|u|y['\u2019]?all)|\bI(?:['\u2019]ll|[ \t]+will|['\u2019]m[ \t]+gonna|[ \t]+am[ \t]+going[ \t]+to))[ \t]+stop[ \t]+(?:texting|messaging|contacting))|\bstop[ \t]+sending[ \t]+(me|us|these|those|texts?|messages?)\b|\b(do[ \t]+not|don['\u2019]?t)[ \t]+(text|message|contact|sms)[ \t]+(me|us|this[ \t]+number)\b|\bno[ \t]+more[ \t]+(texts?|text[ \t]+messages?|messages?)\b|\b(remove|take)[ \t]+(me|my[ \t]+number)[ \t]+(off|from)[ \t]+(?:(?:the|your|this|our|my)[ \t]+)?(?:list|text(?:ing)?[ \t]+list|sms[ \t]+list|message[ \t]+list|marketing[ \t]+list|contact[ \t]+list|texts?|messages?|sms)\b|\b(unsubscribe|opt[ \t-]?out)[ \t]+(me|us|this[ \t]+number)\b|\b(want|like|need)[ \t]+to[ \t]+(unsubscribe|opt[ \t-]?out)\b|\bopt[ \t]+me[ \t]+out\b/i, intent: "unsubscribe", autoAction: "unsubscribe-customer", confidence: 95 },

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
  // "cancel text me when you have an opening": a cancel that asks to be
  // contacted again is a reschedule request. A person reads it; the booking is
  // not auto-cancelled (audit-2026-09-29-F3).
  { pattern: /\bcancel\b.*\b(?:text|call|message)[ \t]+(?:me|us)\b/i, intent: "reschedule", autoAction: "flag-for-followup", confidence: 75 },
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

  const withoutNegated = trimmed.replace(NEGATED_REVOCATION_PATTERN, " ");
  if (withoutNegated !== trimmed) {
    // Remove only the negated span, then honour any revocation in the rest.
    for (const p of PATTERNS) {
      if (p.intent === "unsubscribe" && p.pattern.test(withoutNegated)) {
        log.info("SMS revokes consent outside a negated phrase", { confidence: p.confidence });
        return {
          intent: "unsubscribe",
          confidence: p.confidence,
          autoAction: p.autoAction,
          requiresHuman: false,
          extractedData: { message: trimmed },
        };
      }
    }
    log.info("SMS contains a negated revocation phrase; routing to human");
    return {
      intent: "unknown",
      confidence: 0,
      requiresHuman: true,
    };
  }

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
