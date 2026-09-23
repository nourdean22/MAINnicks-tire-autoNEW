/**
 * One log line for every orchestrated text that did NOT go out.
 *
 * WHY. The orchestrator records its decision (cooldown, opt-out, auto-send off,
 * human takeover, draft-only …) in sms_orchestrations and nowhere else. On
 * 2026-09-23 a forwarded test call got no follow-up text and the Railway log
 * showed nothing at all after "Vapi call ended": the reason was only readable
 * with database access. Consumer: orchestrateSms in services/smsOrchestrator.ts.
 *
 * Never the number: the last 4 digits only, like the rest of the SMS logs.
 */

/** Statuses that mean the text went out or is on its way. Everything else did not send. */
const SENT_STATUSES: ReadonlySet<string> = new Set(["sent", "queued", "sending", "delivered", "replied"]);

export interface NotSentLogFields {
  type: string;
  status: string;
  reason: string;
  phoneSuffix: string;
}

/** The orchestrator's starting value for `reason`: it says nothing about the cause. */
const DEFAULT_REASON = "system_triggered";

/**
 * The most specific cause the result carries. `reason` stays at its
 * "system_triggered" default on several not-sent paths (the preflight guard,
 * draft-only mode, an internal error) that record the real code only in
 * noSendReason / statusReason. On 2026-09-23 a recap held for a
 * hallucinated_url logged "system_triggered".
 */
function causeOf(result: { reason?: string | null; statusReason?: string | null; noSendReason?: string | null }): string {
  if (result.noSendReason) return result.noSendReason;
  if (result.reason && result.reason !== DEFAULT_REASON) return result.reason;
  return result.statusReason || result.reason || "unspecified";
}

/** Null when the text went out; otherwise the fields to log. */
export function notSentLogFields(
  event: { type: string; phone?: string | null },
  result: { status: string; reason?: string | null; statusReason?: string | null; noSendReason?: string | null },
): NotSentLogFields | null {
  if (SENT_STATUSES.has(result.status)) return null;
  const digits = String(event.phone ?? "").replace(/\D/g, "");
  return {
    type: event.type,
    status: result.status,
    reason: causeOf(result),
    phoneSuffix: digits.length >= 4 ? digits.slice(-4) : "????",
  };
}
