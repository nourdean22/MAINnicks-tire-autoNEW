/**
 * Feature-flag SAFETY POLICY — which flags contact customers, and which ones
 * mean the opposite of what their name suggests.
 *
 * WHY THIS EXISTS
 *
 * The admin panel decided "is this flag dangerous?" by running a regex over the
 * flag KEY. Two things went wrong with that, both live in production:
 *
 * 1. POLARITY. `sms_global_pause` is an OFF-switch — setting it TRUE *pauses*
 *    all automated customer SMS shop-wide. It matched the regex via `sms_`, so
 *    flipping the emergency stop ON raised a red danger modal reading "This flag
 *    activates customer-contacting messages... may send to real customers", with
 *    the cancel button labelled "Keep OFF". In the one moment the switch exists
 *    for, the operator was told the pause was a send, and the reassuring button
 *    resumed sending. Resuming — the genuinely dangerous direction — was silent.
 *
 * 2. COVERAGE. A regex over names cannot know what a flag does. Eight flags that
 *    contact customers did not match, including `nickgpt_low_risk_autosend_enabled`,
 *    which smsOrchestrator reads to auto-send an inbound reply with NO human in
 *    the loop. Note the near-miss that made this hard to spot: the pattern needs
 *    `sms_` WITH a trailing underscore, so `weather_triggered_sms` — where the
 *    token is at the END of the key — slipped straight through.
 *
 * So the policy is data, not pattern-matching. The regex is retained ONLY as a
 * fallback for keys nobody has classified yet, and it may only ever ADD caution.
 *
 * Adding a flag that can reach a customer? Put it in CUSTOMER_FACING_FLAGS.
 * Adding an off-switch? Put it in INVERTED_FLAGS. Both are asserted by tests.
 */

/**
 * Flags whose TRUE value STOPS something. For these, the dangerous direction is
 * OFF (it resumes contacting customers), which is the exact inverse of every
 * other flag here.
 */
export const INVERTED_FLAGS: ReadonlySet<string> = new Set([
  "sms_global_pause",
  "vapi_forward_followup_paused",
]);

/**
 * Flags that can cause a message, call, or post to reach a real customer.
 *
 * This list is explicit because the consequence of a miss is an unannounced
 * outbound send. It does not need to be exhaustive to be useful — anything not
 * listed still falls through to the regex below — but every entry here is one
 * fewer thing the regex has to guess correctly.
 */
export const CUSTOMER_FACING_FLAGS: ReadonlySet<string> = new Set([
  // Missed by the key regex, and each one can contact a customer:
  "nickgpt_low_risk_autosend_enabled", // auto-sends AI SMS replies, no human
  "weather_triggered_sms",             // token at end of key — regex needs `sms_`
  "vip_auto_recognition",              // auto-SMS new VIPs a 10% off perk
  "referral_loop_closer",
  "predictive_maintenance_alerts",
  "photo_assess_enabled",
  "legacy_autopost_live",              // live IG/FB posting
  "missed_call_recovery",
  // Matched by the regex too, listed so the intent is recorded rather than
  // inferred from a pattern that may later be edited:
  "smart_sms_auto_reply",
]);

/**
 * Legacy key-shape heuristic. Fallback ONLY — for keys not yet classified above.
 *
 * Kept because dropping it would silently DOWNGRADE caution for every flag no
 * one has got round to listing. It can add caution; it can never remove it.
 */
const CUSTOMER_FACING_KEY_PATTERN =
  /(sms_|email_|gbp_|vapi_|drip_|outreach|review_request|retention|cross_sell|win_?back|emergency_)/i;

/** True when flipping this flag can cause an outbound customer touch. */
export function isCustomerFacingFlag(key: string): boolean {
  return CUSTOMER_FACING_FLAGS.has(key) || CUSTOMER_FACING_KEY_PATTERN.test(key);
}

/** True when this flag's TRUE value stops something rather than starting it. */
export function isInvertedFlag(key: string): boolean {
  return INVERTED_FLAGS.has(key);
}

/**
 * Should toggling this flag to `nextValue` require an explicit confirmation?
 *
 * The rule is "confirm the direction that can reach customers", not "confirm
 * ON". For a normal flag that is ON; for an off-switch it is OFF.
 */
export function requiresConfirmation(key: string, nextValue: boolean): boolean {
  if (!isCustomerFacingFlag(key)) return false;
  return isInvertedFlag(key) ? nextValue === false : nextValue === true;
}

/** Operator-facing copy for the confirmation, correct for the flag's polarity. */
export function confirmationCopy(
  key: string,
  nextValue: boolean,
): { title: string; message: string; confirmLabel: string; cancelLabel: string } {
  if (isInvertedFlag(key)) {
    // Only reached when turning an off-switch OFF, i.e. RESUMING sends.
    return {
      title: `Resume automated sending? (${key} OFF)`,
      message:
        "This flag is an OFF-SWITCH. Turning it OFF RESUMES automated customer messages shop-wide — " +
        "anything queued while it was paused may begin sending on the next tick. Confirm the queue is safe first.",
      confirmLabel: "Resume sending",
      cancelLabel: "Stay paused",
    };
  }
  return {
    title: `Flip ${key} ON?`,
    message:
      "This flag activates customer-contacting messages (SMS / email / outreach). Once on, the next cron tick " +
      "may send to real customers. Verify guardrails before continuing.",
    confirmLabel: "Flip ON",
    cancelLabel: "Keep OFF",
  };
}
