import { describe, it, expect } from "vitest";
import { deriveCameraState, deriveStateAtIngest, HEALTH_THRESHOLDS } from "./cameraHealth";

type RuntimeSnapshot = NonNullable<Parameters<typeof deriveCameraState>[0]>;

/** A heartbeat received just now from a fixed producer with everything in order. */
function healthy(over: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  const now = 1_800_000_000;
  return {
    ageSeconds: 5,
    observedAtEdgeEpoch: now,
    receivedAtEpoch: now + 1,
    sourceConnected: true,
    lastHealthyFrameAtEpoch: now - 1,
    frameOk: true,
    poseOk: true,
    calibrationVersion: "shopsign-2026-09-09",
    outboxDepth: 0,
    oldestOutboxAgeSeconds: 0,
    deadLetterDepth: 0,
    ...over,
  };
}

const fixedFacets = {
  producer: "alive",
  source: "connected",
  frames: "fresh",
  pose: "ok",
  calibration: "valid",
  auth: "not_required",
  events: "not_required",
  control: "not_required",
  media: "not_required",
  home: "not_required",
  cloud: "ok",
};

function healthyInteraction(over: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return healthy({
    sourceConnected: null,
    lastHealthyFrameAtEpoch: null,
    frameOk: null,
    poseOk: null,
    calibrationVersion: null,
    authPlaneOk: true,
    eventPlaneOk: true,
    controlPlaneOk: true,
    mediaPlaneOk: true,
    ptzHomeOk: true,
    ...over,
  });
}

describe("camera health lattice — fixed geometry", () => {
  it("a quiet lot is HEALTHY: zero visits is not an input to this function", () => {
    const v = deriveCameraState(healthy());
    expect(v.state).toBe("HEALTHY");
    expect(v.facets).toEqual(fixedFacets);
  });

  it("no heartbeat ever is NEVER_INGESTED, the state the old visit-derived health could not express", () => {
    expect(deriveCameraState(null).state).toBe("NEVER_INGESTED");
    expect(deriveCameraState(healthy({ receivedAtEpoch: null })).state).toBe("NEVER_INGESTED");
  });

  it("liveness comes first: an old heartbeat is STALE then PRODUCER_OFFLINE whatever else it says", () => {
    const T = HEALTH_THRESHOLDS;
    expect(deriveCameraState(healthy({ ageSeconds: T.staleAfterSeconds + 1 })).state).toBe("STALE");
    expect(deriveCameraState(healthy({ ageSeconds: T.offlineAfterSeconds + 1 })).state).toBe("PRODUCER_OFFLINE");
    expect(deriveCameraState(healthy({ ageSeconds: 999, deadLetterDepth: 4 })).state).toBe("PRODUCER_OFFLINE");
    expect(deriveCameraState(healthy({ ageSeconds: null })).state).toBe("STALE");
  });

  it("never HEALTHY while frames are stale, judged on the PRODUCER's clock", () => {
    const now = 1_800_000_000;
    const v = deriveCameraState(healthy({ observedAtEdgeEpoch: now, lastHealthyFrameAtEpoch: now - 40 }));
    expect(v.state).toBe("CAMERA_OFFLINE");
    expect(v.facets.frames).toBe("stale");
    const late = deriveCameraState(healthy({ ageSeconds: 50, observedAtEdgeEpoch: now, lastHealthyFrameAtEpoch: now - 1 }));
    expect(late.state).toBe("HEALTHY");
  });

  it("a disconnected source is CAMERA_OFFLINE even with a recent heartbeat", () => {
    expect(deriveCameraState(healthy({ sourceConnected: false })).state).toBe("CAMERA_OFFLINE");
  });

  it("census mode (no calibration) and a moved camera are CALIBRATION_INVALID, not healthy", () => {
    expect(deriveCameraState(healthy({ calibrationVersion: null })).state).toBe("CALIBRATION_INVALID");
    const moved = deriveCameraState(healthy({ poseOk: false }));
    expect(moved.state).toBe("CALIBRATION_INVALID");
    expect(moved.facets.pose).toBe("invalid");
  });

  it("frozen / looping capture is DEGRADED_VISION when frames are otherwise fresh", () => {
    const v = deriveCameraState(healthy({ frameOk: false }));
    expect(v.state).toBe("DEGRADED_VISION");
    expect(v.facets.frames).toBe("unhealthy");
  });

  it("a queue that is not draining is CLOUD_BACKLOG; dead letters outrank a plain backlog", () => {
    expect(deriveCameraState(healthy({ oldestOutboxAgeSeconds: HEALTH_THRESHOLDS.backlogWarnSeconds + 1 })).state).toBe("CLOUD_BACKLOG");
    const dl = deriveCameraState(healthy({ deadLetterDepth: 2 }));
    expect(dl.state).toBe("CLOUD_BACKLOG");
    expect(dl.facets.cloud).toBe("dead_letters");
    expect(dl.reason).toContain("2 dead-lettered");
  });

  it("precedence is fixed: camera-offline beats calibration beats vision beats cloud", () => {
    const all = healthy({ sourceConnected: false, poseOk: false, frameOk: false, deadLetterDepth: 1 });
    expect(deriveCameraState(all).state).toBe("CAMERA_OFFLINE");
    const noSource = healthy({ poseOk: false, frameOk: false, deadLetterDepth: 1 });
    expect(deriveCameraState(noSource).state).toBe("CALIBRATION_INVALID");
    const posed = healthy({ frameOk: false, deadLetterDepth: 1 });
    expect(deriveCameraState(posed).state).toBe("DEGRADED_VISION");
  });

  it("unknown fixed dimensions stay unknown rather than reading as fine", () => {
    const v = deriveCameraState(healthy({
      sourceConnected: null,
      frameOk: null,
      lastHealthyFrameAtEpoch: null,
      poseOk: null,
      outboxDepth: null,
      oldestOutboxAgeSeconds: null,
      deadLetterDepth: null,
    }));
    expect(v.facets).toEqual({
      ...fixedFacets,
      source: "unknown",
      frames: "unknown",
      pose: "unknown",
      cloud: "unknown",
    });
  });

  it("PTZ transport failures do not demote the fixed vehicle-truth camera", () => {
    const v = deriveCameraState(healthy({
      authPlaneOk: false,
      eventPlaneOk: false,
      controlPlaneOk: false,
      mediaPlaneOk: false,
      ptzHomeOk: false,
    }), "fixed_geometry");
    expect(v.state).toBe("HEALTHY");
    expect(v.facets.control).toBe("not_required");
  });

  it("the ingest-time derivation is the same lattice with age pinned to zero", () => {
    const { ageSeconds: _drop, ...rest } = healthy({ ageSeconds: 999 });
    void _drop;
    expect(deriveStateAtIngest(rest).state).toBe("HEALTHY");
  });
});

describe("camera health lattice — interaction PTZ", () => {
  it("does NOT require vehicle calibration, fixed pose or a detector frame", () => {
    const v = deriveCameraState(healthyInteraction(), "interaction_ptz");
    expect(v.state).toBe("HEALTHY");
    expect(v.facets.source).toBe("not_required");
    expect(v.facets.calibration).toBe("not_required");
    expect(v.facets.home).toBe("ok");
  });

  it("unknown required planes are UNVERIFIED_CAPABILITIES, never green", () => {
    const v = deriveCameraState(
      healthyInteraction({ mediaPlaneOk: null, ptzHomeOk: null }),
      "interaction_ptz",
    );
    expect(v.state).toBe("UNVERIFIED_CAPABILITIES");
    expect(v.facets.media).toBe("unknown");
    expect(v.facets.home).toBe("unknown");
  });

  it.each([
    ["authPlaneOk", "AUTH_DEGRADED"],
    ["eventPlaneOk", "EVENTS_DEGRADED"],
    ["controlPlaneOk", "CONTROL_DEGRADED"],
    ["mediaPlaneOk", "MEDIA_DEGRADED"],
    ["ptzHomeOk", "PTZ_HOME_INVALID"],
  ] as const)("%s=false produces %s", (field, expected) => {
    const v = deriveCameraState(healthyInteraction({ [field]: false }), "interaction_ptz");
    expect(v.state).toBe(expected);
  });

  it("known transport failure outranks unknown lower-priority planes", () => {
    const v = deriveCameraState(
      healthyInteraction({ authPlaneOk: true, eventPlaneOk: false, controlPlaneOk: null }),
      "interaction_ptz",
    );
    expect(v.state).toBe("EVENTS_DEGRADED");
  });

  it("producer liveness still outranks every transport self-report", () => {
    const v = deriveCameraState(
      healthyInteraction({
        ageSeconds: HEALTH_THRESHOLDS.offlineAfterSeconds + 1,
        authPlaneOk: false,
        mediaPlaneOk: false,
      }),
      "interaction_ptz",
    );
    expect(v.state).toBe("PRODUCER_OFFLINE");
  });

  it("ingest derives the profile-specific state with age pinned to zero", () => {
    const { ageSeconds: _drop, ...rest } = healthyInteraction({ ageSeconds: 999 });
    void _drop;
    expect(deriveStateAtIngest(rest, "interaction_ptz").state).toBe("HEALTHY");
  });
});
