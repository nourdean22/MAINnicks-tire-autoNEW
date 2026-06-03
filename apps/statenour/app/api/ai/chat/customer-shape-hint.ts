/**
 * buildCustomerShapeHint · chat-route extract
 *
 * Lifted VERBATIM from app/api/ai/chat/route.ts (the customer-shape
 * detector + hard-hint injection, original lines ~864-895).
 *
 * v10.0.503 · ADR-0011 Tier 3 surfacing fix · customer-shape hint.
 * Even with the findCustomer tool registered, the model would
 * sometimes hallucinate customer details rather than calling the
 * tool · the description-clarity gap diagnosed at v10.0.494. This
 * detector recognizes customer-shaped user content (10-digit phone,
 * name patterns, ownership phrasing) and INJECTS a hard hint to
 * call findCustomer first.
 *
 * The detector is cheap (regex · zero AI cost · <1ms) and the hint
 * only fires on matches · non-customer turns stay unchanged.
 * Always-on (no env flag) because the cost of a wrong fabrication
 * is much higher than the cost of an extra tool call.
 *
 * Returns the ready-to-prepend `## CUSTOMER QUERY DETECTED …` block
 * (ending in two newlines) when any signal matched, else null. The
 * caller does `finalSystemPrompt = block + finalSystemPrompt`.
 */

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/chat");

const customerShapeRegex = {
  phone: /\b(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/,
  nameWithAction: /\b(?:tell me about|show me|look up|find|search for|how (?:much|many|long)|what (?:about|did|does|has)|when (?:did|was|will)|customer named|customer called|client named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i,
  // v10.0.503 fix · "does <Name>" wasn't matching · `[A-Z]\b`
  // required the cap letter to be the whole word. Use `[A-Z][a-z]+`
  // to anchor on a proper-name token. Also widened to "did", "has",
  // "was" forms since they imply customer-inquiry too.
  ownershipPhrasing: /\b(?:(?:does|did|has|was|will)\s+[A-Z][a-z]+|[A-Z][a-z]+'s\s+(?:car|truck|vehicle|visits?|history|account|estimates?|invoices?|spend|plate))\b/,
  plateLookup: /\b(?:plate|tag)\s+(?:number\s+)?[A-Z0-9]{4,8}\b/i,
};

/**
 * @returns the `## CUSTOMER QUERY DETECTED …` prefix block to prepend to
 * the system prompt (with its trailing blank line), or null when no
 * customer signal matched.
 */
export function buildCustomerShapeHint(userTextSlice: string): string | null {
  const customerSignals: string[] = [];
  if (customerShapeRegex.phone.test(userTextSlice)) customerSignals.push("phone-digits");
  if (customerShapeRegex.nameWithAction.test(userTextSlice)) customerSignals.push("name-with-action");
  if (customerShapeRegex.ownershipPhrasing.test(userTextSlice)) customerSignals.push("ownership-phrase");
  if (customerShapeRegex.plateLookup.test(userTextSlice)) customerSignals.push("plate");
  if (customerSignals.length > 0) {
    log.info("customer_shape_detected", { signals: customerSignals });
    return `## CUSTOMER QUERY DETECTED · signals: ${customerSignals.join(" + ")}\nYour user appears to be asking about a SPECIFIC customer. You MUST call the \`findCustomer\` tool FIRST with the name or phone digits before asserting any facts about that person (visits, estimates, spend, segment, vehicle, plate). If findCustomer returns no match, tell the user "no customer matched <term>" instead of fabricating details. Do NOT skip this step even if you think you remember the customer from earlier in the conversation · always re-look-up.\n\n`;
  }
  return null;
}
