/**
 * lib/brain/alert-lanes.ts · UI v3 W5b (2026-10-18).
 *
 * The one list of BrainMemory alert categories, and the lane each one lands in. Pure (no prisma),
 * so the "use client" alerts page and the three server consumers (buildActiveAlerts, the Telegram
 * /alerts listing, Nick's command-center state) read the same list instead of three copies.
 *
 * Priority = someone has to act, or data or messaging is at risk. Other = trend signals.
 * Decided in the W5b brief; a new category fails to compile until it is classified here.
 */

export const ALERT_CATEGORIES = [
  "correlation_alert",
  "decision_quality_drift",
  "schema_drift_alert",
  "storage_quota_alert",
  "creation_spike_alert",
  "update_spike_alert",
  "brain_bus_alert",
] as const;

export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export type AlertLane = "priority" | "other";

export const ALERT_LANE = {
  storage_quota_alert: "priority",
  schema_drift_alert: "priority",
  brain_bus_alert: "priority",
  correlation_alert: "priority",
  decision_quality_drift: "other",
  creation_spike_alert: "other",
  update_spike_alert: "other",
} as const satisfies Record<AlertCategory, AlertLane>;

/** A category the map does not know lands in Priority: an unclassified alert is never hidden. */
export function alertLane(category: string): AlertLane {
  return (ALERT_LANE as Record<string, AlertLane>)[category] ?? "priority";
}
