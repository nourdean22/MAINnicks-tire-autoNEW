/**
 * Office lane: is what the office camera records reaching the server? (job
 * 2026-10-21-shop-eyes-ears-pro, F2)
 *
 * The office worker posts ~12-40 conversation episodes an hour in business hours, but its
 * heartbeat is a separate thread on the shop PC (camera-bridge/vision/officewake.py), so a hung
 * transcriber keeps the camera row fresh while no episode arrives, and the camera states never
 * see it. This is a sibling condition on the same 5-minute pass, not a camera state: adding a
 * state to the camera lattice would reach the timeline, the cards and the fleet verdict for
 * something that is not a camera fault. It reuses the pass's claim table, cooldown, episode-key
 * shape and delivery rail; its claims carry their own key family (office_lane:) so a camera
 * recovery never mistakes them for a camera page.
 *
 * Judged only while the shop is open and the office heartbeat is fresh (a stale heartbeat is the
 * camera alert's job). Unknown capture activity is not a fault for this rule: no page.
 */
import { BUSINESS } from "../../shared/business";
import { HEALTH_THRESHOLDS } from "../lib/cameraHealth";
import { cameraAlertCooldownSeconds } from "./cameraHealthAlertPolicy";

/** Captures in the last hour with no post for longer than this pages. */
const NOT_POSTING_AFTER_SECONDS = 60 * 60;

type OfficeLaneState = "CONVERSATIONS_NOT_POSTING" | "CONVERSATIONS_POSTING" | "NOT_JUDGED";

export function officeLaneVerdict(input: {
  shopOpen: boolean;
  heartbeatAgeSeconds: number | null;
  captureAgeSeconds: number | null;
  capturesLast60m: number | null;
  postAgeSeconds: number | null;
}): { state: OfficeLaneState; reason: string } {
  const { heartbeatAgeSeconds: hb, captureAgeSeconds: cap, capturesLast60m: caps, postAgeSeconds: post } = input;
  if (!input.shopOpen) return { state: "NOT_JUDGED", reason: "shop closed" };
  if (hb === null || hb > HEALTH_THRESHOLDS.staleAfterSeconds) {
    return { state: "NOT_JUDGED", reason: "office heartbeat not fresh; the camera alert covers it" };
  }
  if (post !== null && post <= NOT_POSTING_AFTER_SECONDS) {
    return { state: "CONVERSATIONS_POSTING", reason: `last conversation reached the server ${Math.floor(post / 60)} minutes ago` };
  }
  // Unknown capture activity (both NULL) lands here too: unknown is not a fault for this rule.
  const captured = (cap !== null && cap <= NOT_POSTING_AFTER_SECONDS) || (caps !== null && caps > 0);
  if (!captured) return { state: "NOT_JUDGED", reason: "no capture known in the last 60 minutes (quiet or not reported); not a fault for this rule" };
  return {
    state: "CONVERSATIONS_NOT_POSTING",
    reason: post === null
      ? "The office camera is recording but no conversation has ever reached the server."
      : `The office camera is recording but no conversation has reached the server for ${Math.floor(post / 60)} minutes.`,
  };
}

/** Same cooldown as the camera pages: it delays, never drops. A recovery needs a prior NOT_POSTING page. */
export function officeLaneAlertDecision(
  state: OfficeLaneState,
  latestKey: string | null,
  sinceLastAlertSeconds: number | null,
): { notify: boolean; recovery: boolean; held: boolean } {
  const held = sinceLastAlertSeconds !== null && Number.isFinite(sinceLastAlertSeconds) && sinceLastAlertSeconds < cameraAlertCooldownSeconds();
  if (state === "CONVERSATIONS_NOT_POSTING") return { notify: !held, recovery: false, held };
  if (state === "CONVERSATIONS_POSTING") {
    const recovery = Boolean(latestKey && latestKey.endsWith(":CONVERSATIONS_NOT_POSTING"));
    return { notify: recovery && !held, recovery, held: recovery && held };
  }
  return { notify: false, recovery: false, held: false };
}

/**
 * The durable claim, in the camera claims' episode shape. The episode is the moment the last
 * post landed (the silence began there); NULL (never posted) falls back to the shop day.
 */
export function officeLaneAlertClaim(
  camera: string,
  state: "CONVERSATIONS_NOT_POSTING" | "CONVERSATIONS_POSTING",
  episode: number | null,
  now: Date = new Date(),
): { key: string; firedFor: string } {
  const cam = camera.slice(0, 40);
  const shopDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
  if (episode === null) return { key: `office_lane:${cam}:${state}`, firedFor: shopDay(now) };
  return { key: `office_lane:${cam}:e${Math.floor(episode)}:${state}`, firedFor: shopDay(new Date(Math.floor(episode) * 1000)) };
}

export function formatOfficeLaneAlert(label: string, reason: string, recovery: boolean): { title: string; message: string } {
  if (recovery) {
    return {
      title: `Office conversations reaching the server again — ${label}`,
      message: `Office conversations are reaching the server again: the ${reason}.\n\nReview: Admin → Lot / Office.`,
    };
  }
  return {
    title: `Office conversations not reaching the server — ${label}`,
    message: `${reason}\n\nThe camera itself is up; the conversation worker on the shop PC is likely stuck.\n\nReview: Admin → Lot / Office.`,
  };
}
