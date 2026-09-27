import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cameraAlertDecision,
  formatCameraHealthAlert,
  isCameraPagingState,
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

  it("uses the durable, multi-pod-safe alert claim rail", () => {
    expect(service).toContain("INSERT IGNORE INTO cron_alerts_fired");
    expect(service).toContain("affectedRows");
    expect(service).toContain("camera_health:");
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
