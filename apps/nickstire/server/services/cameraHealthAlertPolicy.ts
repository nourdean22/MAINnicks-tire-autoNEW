import { BUSINESS } from "../../shared/business";
import type { deriveCameraState } from "../lib/cameraHealth";

export type CameraHealthState = ReturnType<typeof deriveCameraState>["state"];
export type CameraHealthVerdict = ReturnType<typeof deriveCameraState>;
export type CameraHealthFacets = CameraHealthVerdict["facets"];

const NON_PAGING_STATES = new Set<CameraHealthState>(["HEALTHY", "STALE"]);

/**
 * States the READ side derives from heartbeat age. The producer never reports them, so the
 * row's `stateSince` does not move when one begins; the last heartbeat's time is the only
 * clock that identifies the outage.
 */
const LIVENESS_STATES = new Set<CameraHealthState>(["STALE", "PRODUCER_OFFLINE"]);

/**
 * Minimum gap between two pages about one camera. The 2026-09-18 sign camera dropped 17
 * times in one morning; one page per episode with no floor would have sent 34 messages. The
 * cooldown DELAYS rather than drops: the cron runs every five minutes, and a camera still
 * degraded (or still recovered) once the gap has passed pages then, against the same episode.
 */
const CAMERA_ALERT_COOLDOWN_SECONDS = 30 * 60;

/** The cooldown, for the service's run summary and the tests; the policy applies it itself. */
export function cameraAlertCooldownSeconds(): number {
  return CAMERA_ALERT_COOLDOWN_SECONDS;
}

function isCameraPagingState(state: CameraHealthState): boolean {
  return !NON_PAGING_STATES.has(state);
}

export function cameraAlertDecision(
  state: CameraHealthState,
  latestAlertKey: string | null,
  facets: Pick<CameraHealthFacets, "vision"> | null = null,
  sinceLastAlertSeconds: number | null = null,
): { notify: boolean; recovery: boolean; held: boolean } {
  const held =
    sinceLastAlertSeconds !== null &&
    Number.isFinite(sinceLastAlertSeconds) &&
    sinceLastAlertSeconds < CAMERA_ALERT_COOLDOWN_SECONDS;
  if (state === "HEALTHY") {
    const priorDegraded = Boolean(latestAlertKey && !latestAlertKey.endsWith(":HEALTHY"));
    // A blind camera is not "recovered" because the shop closed. The plausibility canary
    // cannot be judged outside business hours (vision=quiet), so HEALTHY after a
    // DEGRADED_VISION page is a recovery only once the detector is SEEING again -- or the
    // producer reports no window at all (unknown), where the old DEGRADED_VISION meant a
    // frozen capture and HEALTHY is a real recovery.
    const closedNotRecovered =
      priorDegraded &&
      latestAlertKey !== null &&
      latestAlertKey.endsWith(":DEGRADED_VISION") &&
      facets?.vision === "quiet";
    const recovery = priorDegraded && !closedNotRecovered;
    return { notify: recovery && !held, recovery, held: recovery && held };
  }
  const paging = isCameraPagingState(state);
  return { notify: paging && !held, recovery: false, held: paging && held };
}

/**
 * The EPISODE an alert belongs to: the epoch second the camera entered its current state.
 *
 * Before 2026-10-07 the claim key was camera/state/shop-day, which failed both ways: the
 * second real outage of a day was silently deduped against the first, and an outage that
 * crossed midnight paged again at 00:00 with nothing changed. Keyed on the episode, each
 * outage pages once and a recovery pages once, whatever the clock says.
 *
 * Returns null when no clock identifies the episode (NEVER_INGESTED has no heartbeat; a row
 * from before `stateSince` existed) -- the caller then falls back to the day-scoped key.
 */
export function cameraAlertEpisode(input: {
  state: CameraHealthState;
  stateSinceEpoch: number | null;
  receivedAtEpoch: number | null;
}): number | null {
  if (input.state === "NEVER_INGESTED") return null;
  if (LIVENESS_STATES.has(input.state)) return input.receivedAtEpoch;
  return input.stateSinceEpoch ?? input.receivedAtEpoch;
}

/** The episode segment of a claim key written by `cameraAlertClaim`, or null for a legacy key. */
export function episodeFromAlertKey(key: string | null): number | null {
  const m = key === null ? null : /:e(\d+):[A-Z_]+$/.exec(key);
  return m ? Number(m[1]) : null;
}

/**
 * The durable claim for one page: `cron_alerts_fired` (alert_key VARCHAR(100), fired_for
 * DATE). `fired_for` is the shop day the EPISODE began, not today, so the composite key stays
 * the same across midnight. A camera id is clipped to keep the key inside the column.
 */
export function cameraAlertClaim(
  camera: string,
  state: CameraHealthState,
  episode: number | null,
  now: Date = new Date(),
): { key: string; firedFor: string } {
  const cam = camera.slice(0, 40);
  if (episode === null) {
    return { key: `camera_health:${cam}:${state}`, firedFor: cameraAlertShopDay(now) };
  }
  return {
    key: `camera_health:${cam}:e${Math.floor(episode)}:${state}`,
    firedFor: cameraAlertShopDay(new Date(Math.floor(episode) * 1000)),
  };
}

/**
 * Explicit Cleveland shop date. Never derive daily claims from DB/session timezone.
 * Reached through `cameraAlertClaim` (fired_for) and pinned directly by the DST tests.
 */
function cameraAlertShopDay(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
}

export type CameraAlertDelivery = {
  emailAccepted: boolean;
  webhookAccepted: boolean;
  telegramAccepted: boolean;
};

function externalNotificationDelivery(
  result: { emailSent: boolean; pushSent: boolean },
  webhookConfigured: boolean,
): Omit<CameraAlertDelivery, "telegramAccepted"> {
  return {
    emailAccepted: result.emailSent,
    // notifyOwner historically returns true for a console-log-only fallback.
    // That is observability, not owner delivery. Count push only when an actual
    // webhook endpoint exists and the notification layer reports success.
    webhookAccepted: webhookConfigured && result.pushSent,
  };
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function deliverCameraAlertExternally(input: {
  alert: { title: string; message: string };
  notifySystem: (alert: { title: string; message: string }) => Promise<{
    emailSent: boolean;
    pushSent: boolean;
  }>;
  webhookConfigured: boolean;
  sendTelegram: (text: string) => Promise<boolean>;
}): Promise<CameraAlertDelivery> {
  let primary = { emailAccepted: false, webhookAccepted: false };
  try {
    primary = externalNotificationDelivery(
      await input.notifySystem(input.alert),
      input.webhookConfigured,
    );
  } catch {
    // A broken primary rail must not prevent the independent Telegram fallback.
    primary = { emailAccepted: false, webhookAccepted: false };
  }

  // Email or a real webhook already reached the owner. Do not double-page Telegram.
  if (primary.emailAccepted || primary.webhookAccepted) {
    return { ...primary, telegramAccepted: false };
  }

  // Telegram is an existing immediate external rail with its own circuit breaker.
  // sendTelegram uses HTML parse mode, so escape dynamic camera text first.
  // Only its boolean provider acceptance counts; logs/attempts never do.
  let telegramAccepted = false;
  try {
    telegramAccepted = await input.sendTelegram(
      `🚨 ${escapeTelegramHtml(input.alert.title)}\n\n${escapeTelegramHtml(input.alert.message)}`,
    );
  } catch {
    telegramAccepted = false;
  }

  return { ...primary, telegramAccepted };
}

function notificationDelivered(result: CameraAlertDelivery): boolean {
  return result.emailAccepted || result.webhookAccepted || result.telegramAccepted;
}

export function formatCameraHealthAlert(input: {
  camera: string;
  label: string;
  role: string;
  verdict: CameraHealthVerdict;
  recovery: boolean;
}): { title: string; message: string } {
  const { label, role, verdict, recovery } = input;
  const facetSummary = Object.entries(verdict.facets)
    .filter(([, value]) => value !== "not_required")
    .map(([key, value]) => `${key}=${value}`)
    .join(" · ");

  if (recovery) {
    return {
      title: `Camera recovered — ${label}`,
      message:
        `✅ ${label} is HEALTHY again.\n\n` +
        `Authority: ${role.replace(/_/g, " ")}\n` +
        `Proof: ${facetSummary}\n\n` +
        "Review: Admin → Lot / Cameras.",
    };
  }

  return {
    title: `Camera degraded — ${label}`,
    message:
      `🔴 ${label} entered ${verdict.state}.\n\n` +
      `Authority: ${role.replace(/_/g, " ")}\n` +
      `Reason: ${verdict.reason}\n` +
      `Proof: ${facetSummary}\n\n` +
      "Review: Admin → Lot / Cameras.",
  };
}

export async function deliverWithConfirmedNotification(input: {
  camera: string;
  state: CameraHealthState;
  alert: { title: string; message: string };
  notify: (alert: { title: string; message: string }) => Promise<CameraAlertDelivery>;
  releaseClaim: () => Promise<void>;
}): Promise<void> {
  const delivery = await input.notify(input.alert);
  if (notificationDelivered(delivery)) return;

  // A claimed-but-undelivered page must become retryable. Otherwise the durable
  // day claim turns a throttled/failed notification into a day-long silent outage.
  await input.releaseClaim();
  throw new Error(
    `camera-health-alerts: no delivery surface accepted ${input.camera}/${input.state}`,
  );
}
