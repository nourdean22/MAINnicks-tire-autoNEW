/**
 * Pause switches are the inverted feature flags (TRUE = paused or muted). The server marks them (`inverted`) and says
 * who flipped each last (`lastChange`, from the admin audit log); this file only turns keys and dates into words.
 */
const LABELS: Record<string, string> = {
  sms_global_pause: "Automated customer texts",
  send_pause_declined_recovery: "Declined-work recovery texts",
  send_pause_missed_call_recovery: "Missed-call follow-up texts",
  send_pause_weather_sms: "Weather texts",
  send_pause_voice_outbound: "Outbound AI voice calls",
  send_pause_customer_confirmations: "Tire-order confirmations",
  vapi_forward_followup_paused: "Forwarded-call follow-up text",
  vapi_arrival_text_paused: "Arrival text to the manager",
  ig_autopost_paused: "Instagram autopost",
  reel_comment_responder_paused: "Reel comment replies",
  telegram_incident_muted: "Telegram incident alerts",
  telegram_digest_muted: "Telegram digests",
  telegram_approval_muted: "Telegram approval requests",
};

export function pauseSwitchLabel(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ");
}

/** "Oct 20", in the shop's time zone. */
export function shopDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

/** How a paused switch got there: "since Oct 20 by x", or why that is not known. */
export function pausedSince(flag: { lastChange: { by: string; at: string } | null; lastChangeKnown: boolean }): string {
  if (flag.lastChange) return `since ${shopDay(flag.lastChange.at)} by ${flag.lastChange.by}`;
  return flag.lastChangeKnown ? "· never flipped since install" : "· change history unavailable";
}
