/**
 * smsOutcome — ONE definition of "the text actually went out".
 *
 * sendSms() returns success:true in three shapes that a counter must not
 * conflate (server/sms.ts, SmsResult): delivered now (sid present), parked in
 * the durable queue for the 8 AM window (queued:true), and an unresolved
 * gateway timeout (uncertain:true). Every receipt, counter and "mark as sent"
 * in the codebase should derive from these helpers instead of `result.success`
 * — the 2026-09-01 wiring audit found nine sites counting queued texts as sent
 * (see docs/ADMIN-AUTOMATION-SECURITY-DATA-AUDIT-2026-09-01.md, F-3).
 *
 * Deliberately dependency-free so callers can import it without pulling in
 * sms.ts, and so tests that mock "../sms" keep the real classification.
 */
export interface SmsOutcomeShape {
  success: boolean;
  queued?: boolean;
  uncertain?: boolean;
}

export type SmsOutcome = "sent" | "queued" | "uncertain" | "failed";

/** Four-way classification for receipts and counters. "sent" means the gateway accepted the message NOW — not queued, not uncertain. */
export function smsOutcome(result: SmsOutcomeShape | null | undefined): SmsOutcome {
  if (!result || result.success !== true) return "failed";
  if (result.queued) return "queued";
  if (result.uncertain) return "uncertain";
  return "sent";
}

/**
 * "The customer will get this text": delivered now, or durably queued for the
 * 8 AM window. Use it for NOTIFIED-style decisions (advance a work order,
 * count a contact). NOT for whether to consume a send claim — see below.
 */
export function smsWillReachCustomer(result: SmsOutcomeShape | null | undefined): boolean {
  const o = smsOutcome(result);
  return o === "sent" || o === "queued";
}

/**
 * "Do not send this again": the claim (bookings.followUp24hSent,
 * estimates.followUpSent, customers.smsCampaignSent, reminder status …) must
 * be consumed for every outcome except a DEFINITE failure. `uncertain` is a
 * gateway timeout where the relay may well have delivered — sms.ts documents
 * it as "do not retry", and leaving the claim open re-texts the customer on
 * the next tick until a send completes cleanly (Codex/self-review on
 * PR #2063: reminders, estimate follow-ups and campaign retries all did).
 * Count uncertain separately; never call it sent.
 */
export function smsClaimConsumed(result: SmsOutcomeShape | null | undefined): boolean {
  return smsOutcome(result) !== "failed";
}
