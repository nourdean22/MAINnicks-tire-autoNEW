/**
 * Plain words for the Lot page's diagnostics (job 2026-10-25-admin-tabs-lot).
 *
 * Every lookup falls back to what the server sent, so a code this file has never seen still
 * shows as itself and nothing disappears from the screen. "unknown" always becomes "not known":
 * a plane nobody has measured is never worded like a measured value.
 */

/** Camera health state -> chip words. The keys are CAMERA_STATES in server/lib/cameraHealth.ts. */
const CAMERA_STATE_WORDS = new Map<string, string>([
  ["HEALTHY", "working"],
  ["STALE", "not reporting lately"],
  ["PRODUCER_OFFLINE", "offline"],
  ["CAMERA_OFFLINE", "offline"],
  ["EXPECTED_SOLAR_OFFLINE", "offline, expected on solar"],
  ["AUTH_DEGRADED", "working with problems"],
  ["EVENTS_DEGRADED", "working with problems"],
  ["CONTROL_DEGRADED", "working with problems"],
  ["MEDIA_DEGRADED", "working with problems"],
  ["PTZ_HOME_INVALID", "working with problems"],
  ["CALIBRATION_INVALID", "working with problems"],
  ["DEGRADED_VISION", "working with problems"],
  ["CLOUD_BACKLOG", "working with problems"],
  ["UNVERIFIED_CAPABILITIES", "not yet verified"],
  ["UNKNOWN", "not known"],
]);

export function cameraStateWords(state: string, commissioned: boolean): string {
  // A camera nobody has commissioned has not failed; one that should be reporting and never has, has.
  if (state === "NEVER_INGESTED") return commissioned ? "no report yet" : "not yet verified";
  return CAMERA_STATE_WORDS.get(state) ?? state.replace(/_/g, " ").toLowerCase();
}

/** The word printed for one health facet value (alive, ok, down, unknown, not_required ...). */
export function facetWords(value: string): string {
  return value === "unknown" ? "not known" : value.replace(/_/g, " ");
}

/** The office camera card's five facets, in reading order. */
export const OFFICE_FACET_LABELS = [
  ["producer", "Camera feed"],
  ["events", "Motion events"],
  ["media", "Video"],
  ["control", "Pan and tilt"],
  ["home", "Home position"],
] as const;

const REASON_WORDS = new Map<string, string>([
  [
    "one or more required interaction-camera planes have not been physically proven yet",
    "Some of this camera's functions have not been checked on site yet.",
  ],
]);

export function reasonWords(reason: string): string {
  return REASON_WORDS.get(reason) ?? reason;
}

/** vehicle_visits.entryEvidence is `visitd <STATE>` (camera-bridge/visitd/shop_mirror.py). */
const ENTRY_EVIDENCE_WORDS = new Map<string, string>([
  ["visitd ENTERED_ZONE", "seen entering the lot"],
  ["visitd ARRIVAL_CANDIDATE", "seen staying, possibly arriving"],
  ["visitd CONFIRMED_ARRIVAL", "arrival confirmed"],
]);

export function entryEvidenceWords(evidence: string): string {
  return ENTRY_EVIDENCE_WORDS.get(evidence) ?? evidence;
}

/** estimatedFields lists the states whose timestamp the camera estimated, so the count is a count of times. */
export function estimatedWords(count: number): string {
  return `${count} time${count === 1 ? "" : "s"} estimated`;
}

/** The shop PC the office worker runs on (officeLaneAlert.ts: "front-desk PC (MECHANICS)"); any other host prints as sent. */
const HOST_LABELS = new Map<string, string>([["MECHANICS", "the front-desk PC"]]);

export function hostLabel(host: string): string {
  return HOST_LABELS.get(host) ?? host;
}
