import { BUSINESS } from "../../shared/business";
import type { deriveCameraState } from "../lib/cameraHealth";

export type CameraHealthState = ReturnType<typeof deriveCameraState>["state"];
export type CameraHealthVerdict = ReturnType<typeof deriveCameraState>;

const NON_PAGING_STATES = new Set<CameraHealthState>(["HEALTHY", "STALE"]);

function isCameraPagingState(state: CameraHealthState): boolean {
  return !NON_PAGING_STATES.has(state);
}

export function cameraAlertDecision(
  state: CameraHealthState,
  latestAlertKey: string | null,
): { notify: boolean; recovery: boolean } {
  if (state === "HEALTHY") {
    const recovery = Boolean(latestAlertKey && !latestAlertKey.endsWith(":HEALTHY"));
    return { notify: recovery, recovery };
  }
  return { notify: isCameraPagingState(state), recovery: false };
}

/** Explicit Cleveland shop date. Never derive daily claims from DB/session timezone. */
export function cameraAlertShopDay(now: Date = new Date()): string {
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
