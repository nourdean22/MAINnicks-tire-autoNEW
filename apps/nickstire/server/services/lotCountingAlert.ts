/**
 * Car counter: is the sign camera counting what it sees? (job 2026-10-26-lot-vision-v2)
 *
 * 2026-10-24 and 10-25 the sign camera reported HEALTHY most open minutes with detections flowing
 * and 0 portal crossings, vehicle_visits got no rows, and nothing paged: the camera lattice reads
 * HEALTHY + detections as "seeing". This is a sibling condition on the same 5-minute pass, shaped
 * like the office lane (officeLaneAlert.ts): its own key family (lot_count:), the same cooldown,
 * claim table and delivery rail. Not a camera state, because the camera is fine; the count is not.
 *
 * Same-day invoices are not a usable signal here: ShopDriver rows land around 3 AM and 8 PM ET
 * (vehicleCounterTrust.ts), so the rule is time awake with nothing counted.
 */
import { BUSINESS } from "../../shared/business";
import { cameraAlertCooldownSeconds } from "./cameraHealthAlertPolicy";

/** Watched this long, healthy and seeing, with 0 arrivals, pages. A slow afternoon still has a car in 3 h. */
const NOT_COUNTING_AFTER_MS = 3 * 60 * 60_000;

type LotCountingState = "NOT_COUNTING" | "COUNTING" | "NOT_JUDGED";

/**
 * When today's watch began: the latest of opening, the solar camera waking and the camera last
 * becoming healthy (an outage from the wake until 12:59 must not count as hours watched; Codex on
 * #3307). Null while the shop has not opened, has no hours today, or the solar camera is expected dark.
 */
export function lotWatchedSinceMs(input: {
  openMs: number | null;
  nowMs: number;
  solar: { expectedOffline: boolean; fromMs: number } | null;
  /** camera_runtime.stateSince while the state is HEALTHY; null when unknown. */
  healthySinceMs?: number | null;
}): number | null {
  if (input.openMs === null || input.openMs > input.nowMs) return null;
  if (input.solar?.expectedOffline) return null;
  return Math.max(input.openMs, input.solar ? input.solar.fromMs : -Infinity, input.healthySinceMs ?? -Infinity);
}

export function lotCountingVerdict(input: {
  shopOpen: boolean;
  /** The sign camera's derived state this pass. */
  cameraState: string;
  detectionsLast10m: number | null;
  watchedSinceMs: number | null;
  nowMs: number;
  /** Production arrivals since watchedSinceMs; null when the read failed. */
  arrivalsSinceWatched: number | null;
}): { state: LotCountingState; reason: string } {
  if (!input.shopOpen || input.watchedSinceMs === null) return { state: "NOT_JUDGED", reason: "shop closed or camera not expected awake" };
  if (input.cameraState !== "HEALTHY") return { state: "NOT_JUDGED", reason: `camera ${input.cameraState}; the camera alert covers it` };
  if (input.arrivalsSinceWatched === null) return { state: "NOT_JUDGED", reason: "arrivals read failed; not a verdict" };
  if (input.arrivalsSinceWatched > 0) {
    return { state: "COUNTING", reason: `${input.arrivalsSinceWatched} car(s) counted since ${hhmm(input.watchedSinceMs)}` };
  }
  if (input.detectionsLast10m === null || input.detectionsLast10m <= 0) {
    return { state: "NOT_JUDGED", reason: "the detector sees nothing right now; a quiet lot is not a counting fault" };
  }
  const watchedMs = input.nowMs - input.watchedSinceMs;
  if (watchedMs < NOT_COUNTING_AFTER_MS) return { state: "NOT_JUDGED", reason: "under 3 hours watched" };
  return {
    state: "NOT_COUNTING",
    reason:
      `The sign camera has been healthy and seeing (${input.detectionsLast10m} detections in 10 min) since ` +
      `${hhmm(input.watchedSinceMs)}, and 0 cars counted in ${Math.floor(watchedMs / 60_000 / 60)} h ${Math.floor(watchedMs / 60_000) % 60} min.`,
  };
}

/** Same cooldown as the camera pages: it delays, never drops. A recovery needs a prior NOT_COUNTING page. */
export function lotCountingAlertDecision(
  state: LotCountingState,
  latestKey: string | null,
  sinceLastAlertSeconds: number | null,
): { notify: boolean; recovery: boolean; held: boolean } {
  const held = sinceLastAlertSeconds !== null && Number.isFinite(sinceLastAlertSeconds) && sinceLastAlertSeconds < cameraAlertCooldownSeconds();
  if (state === "NOT_COUNTING") return { notify: !held, recovery: false, held };
  if (state === "COUNTING") {
    const recovery = Boolean(latestKey && latestKey.startsWith("lot_count:") && latestKey.endsWith(":NOT_COUNTING"));
    return { notify: recovery && !held, recovery, held: recovery && held };
  }
  return { notify: false, recovery: false, held: false };
}

/** One page per watch window: the episode is the epoch second the watch began. */
export function lotCountingAlertClaim(
  camera: string,
  state: "NOT_COUNTING" | "COUNTING",
  episode: number,
): { key: string; firedFor: string } {
  const shopDay = new Date(Math.floor(episode) * 1000).toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
  return { key: `lot_count:${camera.slice(0, 40)}:e${Math.floor(episode)}:${state}`, firedFor: shopDay };
}

export function formatLotCountingAlert(label: string, reason: string, recovery: boolean): { title: string; message: string } {
  if (recovery) {
    return {
      title: `Car counter counting again — ${label}`,
      message: `The car counter is counting again: ${reason}.\n\nReview: Admin → Lot.`,
    };
  }
  return {
    title: `Car counter sees cars but counts none — ${label}`,
    message:
      `${reason}\n\nThe camera is fine; the counting step is not. Counts on Admin → Lot are an undercount until this clears.` +
      `\n\nReview: Admin → Lot.`,
  };
}

function hhmm(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}
