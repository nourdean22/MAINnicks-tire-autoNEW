/**
 * The one answer about declined-work recovery. ShopDriver HQ used to show three (the env switch alone said "live",
 * a static catalog line said "dry run", the cron observer said "dormant"); the server derives it once and the
 * client renders the word without re-deriving.
 *
 *   off     the env switch FEATURE_DECLINED_RECOVERY is not 1: nothing sends
 *   paused  the send-pause switch is on: nothing sends
 *   shadow  the env switch is 1 but the send predicate says no sends: the job only reports
 *   live    env on, sends enabled, pause switch read and not paused
 *   unknown env on, sends enabled, and the pause switch could not be read
 */
export type DeclinedRecoveryState = "live" | "shadow" | "paused" | "off" | "unknown";

/**
 * Declined-recovery texts are held by two switches: the lane's own send_pause_declined_recovery and the shop-wide
 * sms_global_pause ("Automated customer texts"; sendSms queues every automated text while it is on). One switch
 * ON holds the lane even if the other could not be read; null (unknown) only when none is on and one is unreadable.
 */
export function combinePauses(...switches: Array<boolean | null>): boolean | null {
  if (switches.some((s) => s === true)) return true;
  return switches.some((s) => s === null) ? null : false;
}

export function deriveDeclinedRecoveryState(input: {
  featureEnabled: boolean;
  sendsEnabled: boolean;
  /** null = the switch could not be read; never false. */
  paused: boolean | null;
}): DeclinedRecoveryState {
  if (!input.featureEnabled) return "off";
  if (input.paused === true) return "paused";
  if (!input.sendsEnabled) return "shadow";
  return input.paused === false ? "live" : "unknown";
}
