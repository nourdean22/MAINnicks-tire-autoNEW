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
  "ig_autopost_paused", // TRUE stops the scheduled Instagram image autopost
  "reel_comment_responder_paused", // TRUE stops public IG comment replies
  // C5.5 runtime pauses for the env-armed send lanes (server/services/sendPause.ts)
  "send_pause_voice_outbound",
  "send_pause_customer_confirmations",
  "send_pause_declined_recovery",
  "send_pause_weather_sms",
  "send_pause_missed_call_recovery",
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
  "service_reminders_from_invoices",   // maintenance reminder texts from closed jobs
  "photo_assess_enabled",
  "legacy_autopost_live",              // live IG/FB posting
  "missed_call_recovery",
  "ig_autopost_paused",                // inverted: OFF resumes unattended IG/FB posting
  "reel_comment_responder_paused",     // inverted: OFF resumes unattended public IG replies
  "send_pause_voice_outbound",         // inverted: OFF resumes AI voice calls to customers
  "send_pause_customer_confirmations", // inverted: OFF resumes tire-order confirmation texts and emails
  "send_pause_declined_recovery",      // inverted: OFF resumes declined-estimate texts
  "send_pause_weather_sms",            // inverted: OFF resumes weather texts to lapsed customers
  "send_pause_missed_call_recovery",   // inverted: OFF resumes missed-caller texts
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

/**
 * Resume copy for the C5.5 send pauses. Each cron lane skips its NEW sends while paused, but a text that was
 * already in the delayed SMS queue (quiet hours, gateway offline) is HELD there and goes out on resume
 * (round 2). Calls are never queued. The card shows that count as sendSwitchesStatus.heldQueued.
 */
const SEND_PAUSE_RESUME_COPY: Record<string, { title: string; message: string; confirmLabel: string }> = {
  send_pause_voice_outbound: {
    title: "Resume outbound calls?",
    message:
      "Resuming lets the recovery, confirmation and follow-up crons place AI voice calls to customers again on " +
      "their next run, inside each lane's own hours and caps. Nothing was queued while paused.",
    confirmLabel: "Resume calls",
  },
  send_pause_customer_confirmations: {
    title: "Resume tire-order confirmations?",
    message:
      "Resuming lets order confirmation texts and emails go out again on the next order update. " +
      "Confirmations skipped while paused are not resent, but confirmation texts already queued (gateway offline) " +
      "and held by the pause go out when you resume.",
    confirmLabel: "Resume confirmations",
  },
  send_pause_declined_recovery: {
    title: "Resume declined-work follow-up texts?",
    message:
      "Resuming lets the declined-estimate follow-up texts send again on the next run, inside the per-run cap. " +
      "Texts already queued for the morning window and held by the pause go out when you resume.",
    confirmLabel: "Resume texts",
  },
  send_pause_weather_sms: {
    title: "Resume weather texts?",
    message:
      "Resuming lets weather-triggered texts go to lapsed customers again the next time a trigger fires. " +
      "Weather texts already queued and held by the pause go out when you resume.",
    confirmLabel: "Resume texts",
  },
  send_pause_missed_call_recovery: {
    title: "Resume missed-call follow-up texts?",
    message:
      "Resuming lets the cron text callers from the last 24 hours who were not helped, on its next run. " +
      "Follow-up texts already queued and held by the pause go out when you resume.",
    confirmLabel: "Resume texts",
  },
};

/** Operator-facing copy for the confirmation, correct for the flag's polarity. */
export function confirmationCopy(
  key: string,
  nextValue: boolean,
): { title: string; message: string; confirmLabel: string; cancelLabel: string } {
  if (key === "ig_autopost_paused") {
    // Resuming this pause restarts unattended image posts; there is no SMS queue.
    return {
      title: "Resume the image autopost to Instagram and Facebook? (ig_autopost_paused OFF)",
      message:
        "Resuming lets the image autopost cron post to Instagram and the Facebook Page unattended at the next slot " +
        "(8:07, 13:07 or 20:07 ET). Nothing is queued; the next slot simply runs.",
      confirmLabel: "Resume posting",
      cancelLabel: "Stay paused",
    };
  }
  if (key === "reel_comment_responder_paused") {
    // Resuming this pause restarts unattended public comment replies; there is no SMS queue.
    return {
      title: "Resume public comment replies? (reel_comment_responder_paused OFF)",
      message:
        "Resuming lets the responder post public replies to Instagram comments on recent reels, unattended, " +
        "on the next pulse (every 15 minutes). Nothing is queued.",
      confirmLabel: "Resume replies",
      cancelLabel: "Stay paused",
    };
  }
  const sendPause = SEND_PAUSE_RESUME_COPY[key];
  if (sendPause) {
    // A held send on these lanes is skipped, not queued, so resuming never releases a backlog.
    return {
      title: `${sendPause.title} (${key} OFF)`,
      message: sendPause.message,
      confirmLabel: sendPause.confirmLabel,
      cancelLabel: "Stay paused",
    };
  }
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
