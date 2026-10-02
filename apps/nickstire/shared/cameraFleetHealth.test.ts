import { describe, expect, it } from "vitest";
import { summarizeCameraFleet } from "./cameraFleetHealth";

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
});
