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

export function externalNotificationDelivery(
  result: { emailSent: boolean; pushSent: boolean },
  webhookConfigured: boolean,
): { emailAccepted: boolean; webhookAccepted: boolean } {
  return {
    emailAccepted: result.emailSent,
    // notifyOwner historically returns true for a console-log-only fallback.
    // That is observability, not owner delivery. Count push only when an actual
    // webhook endpoint exists and the notification layer reports success.
    webhookAccepted: webhookConfigured && result.pushSent,
  };
}

function notificationDelivered(result: {
  emailAccepted: boolean;
  webhookAccepted: boolean;
}): boolean {
  return result.emailAccepted || result.webhookAccepted;
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
  notify: (alert: { title: string; message: string }) => Promise<{
    emailAccepted: boolean;
    webhookAccepted: boolean;
  }>;
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
