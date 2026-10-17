/**
 * How a durable queued SMS is replayed by the drain in server/sms.ts.
 *
 * WHY (2026-09-23, audit of the careers owner alert): a queued sms_messages
 * row stores the body and variantKey, not the send options. After a restart,
 * rehydrateQueuedFromDb rebuilt every row with NO messageClass, so a row
 * addressed to an internal line (the operator's mobile, a staff line) was
 * refused on replay by sendSms's own internal-line guard and dead-lettered
 * after MAX_SEND_ATTEMPTS. Railway restarts the app on every merge, so any
 * operator alert queued while the store phone was offline could be lost.
 * The drain also held internal messages until 8 AM, although sendSms exempts
 * them from quiet hours when it sends directly.
 *
 * Both answers come from the DESTINATION, which the row does keep. The guard
 * runs before every queueForLater call, so a queued row addressed to an
 * internal line was queued with explicit internal intent or a human trigger;
 * replaying it as internal repeats that decision instead of widening it.
 * Customer numbers are untouched: they keep the quiet-hour hold and replay
 * exactly as before.
 */
import { internalLineFor } from "../services/nonCustomerFilter";
import type { SendPauseLane } from "../services/sendPause";

/** True when the destination is one of the shop's own lines — never a customer. */
export function isInternalLineDestination(to: string): boolean {
  return internalLineFor(to) !== null;
}

/**
 * Send options a rehydrated row must be replayed with, or null for a customer
 * number (replayed with no options, as before).
 */
export function queuedReplayIntent(to: string): { messageClass: "internal" } | null {
  return isInternalLineDestination(to) ? { messageClass: "internal" } : null;
}

/** sms_messages.variantKey for a missed-call recovery cron text (set by the orchestrator for source
 *  "missed_call_recovery"), so a queued one maps back to its send_pause lane. 20 chars, fits varchar(50). */
export const MISSED_CALL_RECOVERY_VARIANT_KEY = "missed_call_recovery";

/**
 * The send_pause lane a queued text belongs to, or null (no lane check: the
 * drain's behaviour before C5.5 round 2). A text queued before a pause must be
 * held by it, so the drain asks shouldHold for this lane before replaying.
 * In-memory rows carry their send options; a rehydrated row has only its stored
 * variantKey, which is why the confirm:* / declined_* keys are matched too.
 */
export function queuedSendPauseLane(messageClass: string | undefined, variantKey: string | null | undefined): SendPauseLane | null {
  if (messageClass === "customer_confirmation" || variantKey?.startsWith("confirm:")) return "customer_confirmations";
  // declinedRecoverySequence.variantKey(): declined_<n>d_<profile>
  if (variantKey && /^declined_\d+d_P\d$/.test(variantKey)) return "declined_recovery";
  // weatherIntelligence.sendWeatherSms: variantKey weather_<triggerId>
  if (variantKey && /^weather_[a-z_]+$/.test(variantKey)) return "weather_sms";
  if (variantKey === MISSED_CALL_RECOVERY_VARIANT_KEY) return "missed_call_recovery";
  return null;
}