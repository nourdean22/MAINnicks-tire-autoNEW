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

// ── Dismiss with a reason (stored as BrainMemory category alert_dismiss, read by alert-suppression.ts) ──

export const ALERT_DISMISS_REASONS = ["expected", "fixed", "noise"] as const;
export type AlertDismissReason = (typeof ALERT_DISMISS_REASONS)[number];
/** A dismissal expires so a recurring real problem can come back. */
export const ALERT_DISMISS_DAYS = 30;

/** What one dismissal covers: the recurring signal, or only the row that was tapped. */
export interface AlertSignal {
  scope: "signal" | "row";
  identity: string;
}

const HOUR_SUFFIX = /^(.+):\d{4}-\d{2}-\d{2}T\d{2}$/;

/**
 * The stable identity of the problem an alert row reports, read from how each producer keys it:
 *   correlation_alert    `<a>__<b>` per metric pair (lib/brain/correlation-alarm.ts) -> the pair
 *   creation_spike_alert `<entityType>:<YYYY-MM-DDTHH>` (lib/db/creation-spike-detector.ts) -> the entity type
 * Every other category keys rows per occurrence (decision_quality_drift: week-ending date;
 * brain_bus_alert: `dead-event:<id>`) or has no producer in this repo (schema_drift_alert,
 * storage_quota_alert, update_spike_alert), so a dismissal covers that row only.
 */
export function alertSignal(category: string, key: string): AlertSignal {
  if (category === "correlation_alert" && key.includes("__")) return { scope: "signal", identity: key };
  if (category === "creation_spike_alert") {
    const m = HOUR_SUFFIX.exec(key);
    if (m) return { scope: "signal", identity: m[1] };
  }
  return { scope: "row", identity: key };
}

/** The alert_dismiss row key for an alert row. Scope is part of the key so a row key never collides with a signal. */
export function alertDismissKey(category: string, key: string): string {
  const s = alertSignal(category, key);
  return `${category}:${s.scope}:${s.identity}`;
}
