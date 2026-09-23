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
