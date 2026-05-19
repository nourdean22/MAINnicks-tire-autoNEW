/**
 * VAPI assistant-request handler · 2026-05-18 PM · Phase 6 (cross-call
 * memory hydration).
 *
 * Why this exists · per the ai-agent-development workflow audit, the
 * VAPI shop Nick treated every caller as a stranger. A customer who
 * called yesterday with a 2014 Accord brake job is greeted the same
 * way as a first-time caller. This change wires the existing
 * `lookupCustomer` query into VAPI's pre-call `assistant-request`
 * webhook so the agent's first words are personal when we know who's
 * calling.
 *
 * Mechanism · VAPI sends an `assistant-request` webhook BEFORE the
 * call connects. Our response can include `assistantOverrides` to
 * tweak the assistant for THAT call only (no PATCH to the global
 * assistant). The lightest override is `firstMessage`. We swap it in
 * when lookupCustomer returns `found: true`.
 *
 * Brand voice · uses the existing operator-grade tone (short, direct,
 * no fluff). Matches the `"Nick's Tire and Auto — what can I do for
 * you?"` default cadence.
 *
 * Fail-open · any error returns `null` so VAPI uses the assistant's
 * configured first message. This NEVER blocks a call.
 *
 * PII boundary · we use only the existing PII projection from
 * `voiceAgentRouter.lookupCustomer` (firstName + vehicle string ·
 * never lastName · never raw phone · never balance amount).
 */

import { createLogger } from "../lib/logger";

const log = createLogger("services:vapi-personalization");

export interface PersonalizationResult {
  /** When set, VAPI uses this string as the first thing the agent says. */
  firstMessage?: string;
  /** Diagnostic only · why we did / didn't personalize. Surfaced in admin. */
  reason: string;
  /** True iff we identified the caller from existing customers. */
  matched: boolean;
}

/**
 * Build a personalized first-message override for a known caller.
 * Returns `null` when the caller is unknown OR lookup fails — caller
 * should respond to VAPI with `{}` (no override · use assistant default).
 */
export async function buildPersonalizedFirstMessage(
  phone: string,
): Promise<PersonalizationResult> {
  try {
    // Delegate to the existing voiceAgentRouter.lookupCustomer · same
    // PII projection · same phone-format tolerance · drift-proof. We
    // construct an internal caller so the procedure's auth gate
    // accepts the call.
    const { voiceAgentRouter } = await import("../routers/voiceAgent");
    const caller = voiceAgentRouter.createCaller({
      user: null,
      isVoiceAgentInternal: true,
    } as never);
    const lookup = await caller.lookupCustomer({ phone });

    if (!lookup.found) {
      return {
        matched: false,
        reason: `unknown caller (${lookup.reason ?? "no match"})`,
      };
    }

    const firstName = lookup.firstName?.trim();
    if (!firstName) {
      // Customer record exists but has no first name · won't be more
      // personal than the default · skip.
      return {
        matched: true,
        reason: "matched but no firstName",
      };
    }

    // Brand voice · short · direct · no fluff. Matches the cadence of
    // the default first message ("Nick's Tire and Auto — what can I do
    // for you?"). When we know the vehicle, anchor the greeting to it
    // so the customer feels seen without us being creepy about it.
    const firstMessage = lookup.vehicle
      ? `Nick's Tire and Auto — ${firstName}, welcome back. What's going on with the ${lookup.vehicle}?`
      : `Nick's Tire and Auto — ${firstName}, welcome back. What can I do for you?`;

    return {
      matched: true,
      reason: `matched: ${firstName}${lookup.vehicle ? ` · ${lookup.vehicle}` : ""}`,
      firstMessage,
    };
  } catch (err) {
    log.warn("buildPersonalizedFirstMessage failed", {
      phoneSuffix: phone.replace(/\D/g, "").slice(-4),
      err: err instanceof Error ? err.message : String(err),
    });
    return { matched: false, reason: "lookup error" };
  }
}
