import { describe, expect, it } from "vitest";
import {
  conversationCaptureStuck,
  summarizeCameraFleet,
  WORKER_STALE_AFTER_SECONDS,
} from "./cameraFleetHealth";

const cam = (over: Record<string, unknown>) => ({
  camera: "sign",
  label: "Shop sign",
  state: "HEALTHY",
  commissioned: true,
  registered: true,
  conversation: null,
  ...over,
});

describe("summarizeCameraFleet", () => {
  it("is HEALTHY only when every commissioned camera is HEALTHY", () => {
    const v = summarizeCameraFleet({ ok: true, cameras: [cam({}), cam({ camera: "office", conversation: { workerOk: true, state: "RUNNING" } })] });
    expect(v.state).toBe("HEALTHY");
    expect(v.problems).toEqual([]);
  });

  it("the 2026-10-02 production shape is DEGRADED, naming each child", () => {
    const v = summarizeCameraFleet({
      ok: true,
      cameras: [
        cam({ camera: "sign", state: "CAMERA_OFFLINE" }),
        cam({ camera: "right", label: "Right", state: "CALIBRATION_INVALID" }),
        cam({ camera: "office", label: "Office", state: "HEALTHY", conversation: { workerOk: true, state: "STALE" } }),
      ],
    });
    expect(v.state).toBe("DEGRADED");
    expect(v.problems.map((p) => p.state)).toEqual(["CAMERA_OFFLINE", "CALIBRATION_INVALID", "conversation worker STALE"]);
  });

  it("an uncommissioned camera never degrades the fleet", () => {
    const v = summarizeCameraFleet({ ok: true, cameras: [cam({}), cam({ camera: "inside", commissioned: false, state: "NEVER_INGESTED" })] });
    expect(v.state).toBe("HEALTHY");
  });

  it("an unregistered producer always counts", () => {
    const v = summarizeCameraFleet({ ok: true, cameras: [cam({}), cam({ camera: "ghost", registered: false, commissioned: false })] });
    expect(v.state).toBe("DEGRADED");
  });

  it("a failed or missing read is UNKNOWN, never HEALTHY", () => {
    expect(summarizeCameraFleet({ ok: false, reason: "boom" }).state).toBe("UNKNOWN");
    expect(summarizeCameraFleet(undefined).state).toBe("UNKNOWN");
    expect(summarizeCameraFleet({ ok: true, cameras: [] }).state).toBe("UNKNOWN");
  });

  it("a stopped worker with no state string is still a problem", () => {
    const v = summarizeCameraFleet({ ok: true, cameras: [cam({ conversation: { workerOk: false, state: null } })] });
    expect(v.problems[0].state).toBe("conversation worker STOPPED");
  });

  it("a READY self-report older than the stale window is a problem: the 2026-10-05 hung worker read live for hours", () => {
    const stale = summarizeCameraFleet({
      ok: true,
      cameras: [cam({ camera: "office", label: "Office", conversation: { workerOk: true, state: "READY", workerAgeSeconds: WORKER_STALE_AFTER_SECONDS + 240 } })],
    });
    expect(stale.state).toBe("DEGRADED");
    expect(stale.problems[0].state).toBe("conversation worker STALE (last report 6m ago)");

    const fresh = summarizeCameraFleet({
      ok: true,
      cameras: [cam({ camera: "office", conversation: { workerOk: true, state: "READY", workerAgeSeconds: 30 } })],
    });
    expect(fresh.state).toBe("HEALTHY");
    // No age reported (an older lot.health) is not stale: unknown stays unknown here and is
    // judged by the state string alone, as before.
    const unaged = summarizeCameraFleet({ ok: true, cameras: [cam({ camera: "office", conversation: { workerOk: true, state: "READY" } })] });
    expect(unaged.state).toBe("HEALTHY");
  });

  it("a worker CAPTURING for 4 days is named as stuck even behind the camera's own amber state (2026-10-22..26)", () => {
    const v = summarizeCameraFleet({
      ok: true,
      cameras: [
        cam({
          camera: "office",
          label: "Office",
          state: "UNVERIFIED_CAPABILITIES",
          conversation: { workerOk: true, state: "CAPTURING", workerAgeSeconds: 10, captureAgeSeconds: 4 * 24 * 3600 },
        }),
      ],
    });
    expect(v.problems.map((p) => p.state)).toEqual(["conversation worker stuck in one recording (96h), not listening"]);
    // A heartbeat that stopped mid-capture keeps the camera's own outage (Codex review on #3297).
    const offline = summarizeCameraFleet({
      ok: true,
      cameras: [
        cam({
          camera: "office",
          label: "Office",
          state: "PRODUCER_OFFLINE",
          conversation: { workerOk: true, state: "CAPTURING", workerAgeSeconds: 3 * 3600, captureAgeSeconds: 4 * 24 * 3600 },
        }),
      ],
    });
    expect(offline.problems.map((p) => p.state)).toEqual(["PRODUCER_OFFLINE"]);
    // The 15-minute line: a capture is at most 120 s + ffmpeg's 120 s timeout.
    expect(conversationCaptureStuck({ state: "CAPTURING", captureAgeSeconds: 15 * 60 - 1 })).toBe(false);
    expect(conversationCaptureStuck({ state: "CAPTURING", captureAgeSeconds: 15 * 60 + 1 })).toBe(true);
    expect(conversationCaptureStuck({ state: "READY", captureAgeSeconds: 4 * 24 * 3600 })).toBe(false);
    expect(conversationCaptureStuck({ state: "CAPTURING", captureAgeSeconds: null })).toBe(false);
  });
});

describe("cameraProblemSeverity (Settings > Status)", () => {
  it("an EXPECTED state is a warning, a real loss is an alert", async () => {
    const { cameraProblemSeverity, isExpectedCameraState } = await import("./cameraFleetHealth");
    expect(cameraProblemSeverity("EXPECTED_SOLAR_OFFLINE")).toBe("warning");
    expect(isExpectedCameraState("EXPECTED_SOLAR_OFFLINE")).toBe(true);
    // Positive controls: the states that must still alarm.
    expect(cameraProblemSeverity("PRODUCER_OFFLINE")).toBe("alert");
    expect(cameraProblemSeverity("CAMERA_OFFLINE")).toBe("alert");
    expect(cameraProblemSeverity("NEVER_INGESTED")).toBe("alert");
    expect(cameraProblemSeverity("UNREGISTERED (HEALTHY)")).toBe("alert");
    expect(cameraProblemSeverity("STALE")).toBe("warning");
    expect(isExpectedCameraState("PRODUCER_OFFLINE")).toBe(false);
  });
});
