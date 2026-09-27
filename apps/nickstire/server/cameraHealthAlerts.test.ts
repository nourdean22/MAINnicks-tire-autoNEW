import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cameraAlertDecision,
  cameraAlertShopDay,
  deliverClaimedAlert,
  formatCameraHealthAlert,
  isCameraPagingState,
  notificationDelivered,
} from "./services/cameraHealthAlerts";

describe("camera health alert policy", () => {
  it("does not page transient STALE or an ordinary healthy camera", () => {
    expect(isCameraPagingState("STALE")).toBe(false);
    expect(cameraAlertDecision("STALE", null)).toEqual({ notify: false, recovery: false });
    expect(cameraAlertDecision("HEALTHY", null)).toEqual({ notify: false, recovery: false });
    expect(cameraAlertDecision("HEALTHY", "camera_health:sign:HEALTHY")).toEqual({
      notify: false,
      recovery: false,
    });
  });

  it("pages measured degradation states", () => {
    for (const state of [
      "NEVER_INGESTED",
      "PRODUCER_OFFLINE",
      "CAMERA_OFFLINE",
      "AUTH_DEGRADED",
      "EVENTS_DEGRADED",
      "CONTROL_DEGRADED",
      "MEDIA_DEGRADED",
      "PTZ_HOME_INVALID",
      "UNVERIFIED_CAPABILITIES",
      "CALIBRATION_INVALID",
      "DEGRADED_VISION",
      "CLOUD_BACKLOG",
    ] as const) {
      expect(cameraAlertDecision(state, null), state).toEqual({
        notify: true,
        recovery: false,
      });
    }
  });

  it("sends recovery only after a prior degraded camera alert", () => {
    expect(
      cameraAlertDecision("HEALTHY", "camera_health:sign:CAMERA_OFFLINE"),
    ).toEqual({ notify: true, recovery: true });
    expect(
      cameraAlertDecision("HEALTHY", "camera_health:office:CONTROL_DEGRADED"),
    ).toEqual({ notify: true, recovery: true });
  });

  it("operator copy names authority, state/recovery and proof", () => {
    const degraded = formatCameraHealthAlert({
      camera: "office",
      label: "Office PTZ — interactions",
      role: "interaction_ptz",
      recovery: false,
      verdict: {
        state: "CONTROL_DEGRADED",
        reason: "PTZ/P2P control has a measured failure",
        facets: {
          producer: "alive",
          source: "not_required",
          frames: "not_required",
          pose: "not_required",
          calibration: "not_required",
          auth: "ok",
          events: "ok",
          control: "down",
          media: "unknown",
          home: "unknown",
          cloud: "ok",
        },
      },
    });
    expect(degraded.title).toContain("Camera degraded");
    expect(degraded.message).toContain("CONTROL_DEGRADED");
    expect(degraded.message).toContain("interaction ptz");
    expect(degraded.message).toContain("control=down");

    const recovered = formatCameraHealthAlert({
      camera: "office",
      label: "Office PTZ — interactions",
      role: "interaction_ptz",
      recovery: true,
      verdict: {
        state: "HEALTHY",
        reason: "healthy",
        facets: {
          producer: "alive",
          source: "not_required",
          frames: "not_required",
          pose: "not_required",
          calibration: "not_required",
          auth: "ok",
          events: "ok",
          control: "ok",
          media: "ok",
          home: "ok",
          cloud: "ok",
        },
      },
    });
    expect(recovered.title).toContain("Camera recovered");
    expect(recovered.message).toContain("HEALTHY again");
  });
});

describe("camera health alert delivery truth", () => {
  it("requires at least one confirmed delivery surface", () => {
    expect(notificationDelivered({ emailSent: true, pushSent: false })).toBe(true);
    expect(notificationDelivered({ emailSent: false, pushSent: true })).toBe(true);
    expect(notificationDelivered({ emailSent: true, pushSent: true })).toBe(true);
    expect(notificationDelivered({ emailSent: false, pushSent: false })).toBe(false);
  });

  it("uses the Cleveland shop day even after UTC has rolled over", () => {
    expect(cameraAlertShopDay(new Date("2026-09-27T02:00:00Z"))).toBe("2026-09-26");
    expect(cameraAlertShopDay(new Date("2026-09-27T14:00:00Z"))).toBe("2026-09-27");
  });

  it("releases the daily claim and throws when no delivery surface accepts the alert", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const db = { execute } as any;

    await expect(
      deliverClaimedAlert({
        db,
        camera: "sign",
        state: "CAMERA_OFFLINE",
        shopDay: "2026-09-27",
        alert: { title: "Camera degraded", message: "offline" },
        notify: async () => ({ emailSent: false, pushSent: false }),
      }),
    ).rejects.toThrow("no delivery surface accepted");

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("keeps the claim when at least one delivery surface accepts the alert", async () => {
    const execute = vi.fn();
    const db = { execute } as any;

    await deliverClaimedAlert({
      db,
      camera: "sign",
      state: "CAMERA_OFFLINE",
      shopDay: "2026-09-27",
      alert: { title: "Camera degraded", message: "offline" },
      notify: async () => ({ emailSent: true, pushSent: false }),
    });

    expect(execute).not.toHaveBeenCalled();
  });
});

describe("camera health alert wiring", () => {
  const root = path.resolve(__dirname, "..");
  const service = fs.readFileSync(
    path.join(__dirname, "services", "cameraHealthAlerts.ts"),
    "utf8",
  );
  const scheduler = fs.readFileSync(
    path.join(__dirname, "cron", "scheduler.ts"),
    "utf8",
  );
  const cameras = fs.readFileSync(
    path.join(root, "shared", "cameras.ts"),
    "utf8",
  );

  it("pages commissioned cameras only", () => {
    expect(service).toContain("EXPECTED_CAMERAS.filter((camera) => camera.commissioned)");
    expect(cameras).toContain('camera: "office"');
    expect(cameras).toMatch(/camera: "office"[\s\S]*?commissioned: false/);
  });

  it("uses the durable claim rail but releases an unconfirmed delivery for retry", () => {
    expect(service).toContain("INSERT IGNORE INTO cron_alerts_fired");
    expect(service).toContain("affectedRows");
    expect(service).toContain("camera_health:");
    expect(service).toContain("DELETE FROM cron_alerts_fired");
    expect(service).toContain("notificationDelivered(delivery)");
    expect(service).toContain("throw new Error");
    expect(service).not.toContain("notification_messages");
  });

  it("routes through the proven system notification surface", () => {
    expect(service).toContain('import("../email-notify")');
    expect(service).toContain("notifySystemAlert");
  });

  it("is actually on the five-minute heartbeat tier", () => {
    const heartbeatStart = scheduler.indexOf('name: "heartbeat"');
    const pulseStart = scheduler.indexOf('name: "pulse"');
    expect(heartbeatStart).toBeGreaterThanOrEqual(0);
    expect(pulseStart).toBeGreaterThan(heartbeatStart);
    const heartbeat = scheduler.slice(heartbeatStart, pulseStart);
    expect(heartbeat).toContain('name: "camera-health-alerts"');
    expect(heartbeat).toContain('import("../services/cameraHealthAlerts")');
  });
});
