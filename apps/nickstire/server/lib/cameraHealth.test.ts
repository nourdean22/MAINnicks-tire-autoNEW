import { describe, it, expect } from "vitest";
import { deriveCameraState, deriveStateAtIngest, HEALTH_THRESHOLDS, shopOpenAt } from "./cameraHealth";

type RuntimeSnapshot = NonNullable<Parameters<typeof deriveCameraState>[0]>;

/** The vision facet as the lattice reports it, for a fixed camera that is otherwise healthy. */
const deriveVisionFacet = (over: Partial<RuntimeSnapshot>) => deriveCameraState(healthy(over)).facets.vision;

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
  // `healthy()` reports no detection window (a pre-0144 edge): unknown, and never a block.
  vision: "unknown",
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
    const backlog = deriveCameraState(healthy({
      outboxDepth: 1,
      oldestOutboxAgeSeconds: HEALTH_THRESHOLDS.backlogWarnSeconds + 1,
      deadLetterDepth: 0,
    }));
    expect(backlog.state).toBe("CLOUD_BACKLOG");
    expect(backlog.facets.cloud).toBe("backlog");

    const dl = deriveCameraState(healthy({ deadLetterDepth: 2 }));
    expect(dl.state).toBe("CLOUD_BACKLOG");
    expect(dl.facets.cloud).toBe("dead_letters");
    expect(dl.reason).toContain("2 dead-lettered");
  });

  it("zero queued events do not become backlog because of a stale leftover age value", () => {
    const v = deriveCameraState(healthy({
      outboxDepth: 0,
      oldestOutboxAgeSeconds: HEALTH_THRESHOLDS.backlogWarnSeconds + 1,
      deadLetterDepth: 0,
    }));
    expect(v.state).toBe("HEALTHY");
    expect(v.facets.cloud).toBe("ok");
  });

  it("the real producer empty-outbox representation is proven healthy", () => {
    const v = deriveCameraState(healthy({
      outboxDepth: 0,
      oldestOutboxAgeSeconds: null,
      deadLetterDepth: 0,
    }));
    expect(v.state).toBe("HEALTHY");
    expect(v.facets.cloud).toBe("ok");
  });

  it("partial cloud telemetry stays UNVERIFIED instead of becoming healthy", () => {
    for (const over of [
      { outboxDepth: 0, oldestOutboxAgeSeconds: null, deadLetterDepth: null },
      { outboxDepth: null, oldestOutboxAgeSeconds: 0, deadLetterDepth: null },
      { outboxDepth: 0, oldestOutboxAgeSeconds: 0, deadLetterDepth: null },
      { outboxDepth: null, oldestOutboxAgeSeconds: null, deadLetterDepth: 0 },
      // A non-empty queue without its oldest age is not complete delivery proof.
      { outboxDepth: 1, oldestOutboxAgeSeconds: null, deadLetterDepth: 0 },
    ]) {
      const v = deriveCameraState(healthy(over));
      expect(v.state).toBe("UNVERIFIED_CAPABILITIES");
      expect(v.facets.cloud).toBe("unknown");
    }
  });

  it("precedence is fixed: camera-offline beats calibration beats vision beats cloud", () => {
    const all = healthy({ sourceConnected: false, poseOk: false, frameOk: false, deadLetterDepth: 1 });
    expect(deriveCameraState(all).state).toBe("CAMERA_OFFLINE");
    const noSource = healthy({ poseOk: false, frameOk: false, deadLetterDepth: 1 });
    expect(deriveCameraState(noSource).state).toBe("CALIBRATION_INVALID");
    const posed = healthy({ frameOk: false, deadLetterDepth: 1 });
    expect(deriveCameraState(posed).state).toBe("DEGRADED_VISION");
  });

  it("unknown fixed dimensions are UNVERIFIED_CAPABILITIES, never healthy", () => {
    const v = deriveCameraState(healthy({
      sourceConnected: null,
      frameOk: null,
      lastHealthyFrameAtEpoch: null,
      poseOk: null,
      outboxDepth: null,
      oldestOutboxAgeSeconds: null,
      deadLetterDepth: null,
    }));
    expect(v.state).toBe("UNVERIFIED_CAPABILITIES");
    expect(v.facets).toEqual({
      ...fixedFacets,
      source: "unknown",
      frames: "unknown",
      pose: "unknown",
      cloud: "unknown",
    });
  });

  it.each([
    ["sourceConnected", null],
    ["frameOk", null],
    ["poseOk", null],
    ["outboxDepth", null],
  ] as const)("missing fixed-camera proof %s blocks HEALTHY", (field, value) => {
    const over: Partial<RuntimeSnapshot> = { [field]: value };
    if (field === "frameOk") over.lastHealthyFrameAtEpoch = null;
    if (field === "outboxDepth") over.oldestOutboxAgeSeconds = null;
    expect(deriveCameraState(healthy(over)).state).toBe("UNVERIFIED_CAPABILITIES");
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

/**
 * The plausibility canary (audit 2026-10-07). On 2026-10-05 the sign lane counted 4 arrivals
 * on a ~40-car day: frames fresh, pose ok, cloud ok, detector RUNNING, and nothing in the
 * lattice asked what it was SEEING. These pin the one shape that is evidence of blindness
 * and every neighbouring shape that is not.
 */
describe("camera health lattice — plausibility canary", () => {
  const seeing = { detectionsLast10m: 3, portalCrossingsLast60m: 0, inferenceAgeSeconds: 5, shopOpen: true };
  const blind = { detectionsLast10m: 0, portalCrossingsLast60m: 0, inferenceAgeSeconds: 12, shopOpen: true };

  it("a detector that ran in the window, saw no vehicle for 10 min and no crossing for 60 min while the shop is open is DEGRADED_VISION", () => {
    const v = deriveCameraState(healthy(blind));
    expect(v.state).toBe("DEGRADED_VISION");
    expect(v.facets.vision).toBe("blind");
    expect(v.reason).toContain("saw no vehicle for 10 min");
    expect(v.reason).toContain("the lot is not being watched");
  });

  it("a detector that sees vehicles is HEALTHY and says so", () => {
    const v = deriveCameraState(healthy(seeing));
    expect(v.state).toBe("HEALTHY");
    expect(v.facets.vision).toBe("seeing");
  });

  it("zero detections are evidence only when the detector RAN inside the window: a shut motion gate is quiet, not blind", () => {
    expect(deriveVisionFacet({ ...blind, inferenceAgeSeconds: HEALTH_THRESHOLDS.blindInferenceMaxAgeSeconds + 1 })).toBe("quiet");
    expect(deriveVisionFacet({ ...blind, inferenceAgeSeconds: null })).toBe("quiet");
    expect(deriveVisionFacet({ ...blind, inferenceAgeSeconds: HEALTH_THRESHOLDS.blindInferenceMaxAgeSeconds })).toBe("blind");
    expect(deriveCameraState(healthy({ ...blind, inferenceAgeSeconds: 900 })).state).toBe("HEALTHY");
  });

  it("a crossing in the last hour proves the portal works: quiet, not blind", () => {
    expect(deriveVisionFacet({ ...blind, portalCrossingsLast60m: 1 })).toBe("quiet");
    expect(deriveVisionFacet({ ...blind, portalCrossingsLast60m: null })).toBe("quiet");
  });

  it("outside business hours an empty lot is quiet, never blind -- and an unknown clock is treated as closed", () => {
    expect(deriveVisionFacet({ ...blind, shopOpen: false })).toBe("quiet");
    expect(deriveVisionFacet({ ...blind, shopOpen: null })).toBe("quiet");
    expect(deriveVisionFacet({ ...blind, shopOpen: undefined })).toBe("quiet");
  });

  it("a producer that reports no window is unknown, and unknown does NOT block HEALTHY", () => {
    // Every edge that predates 0144 reports nothing here. Blocking HEALTHY on it would turn
    // this deploy into an UNVERIFIED_CAPABILITIES page for a camera that is watching fine.
    const v = deriveCameraState(healthy());
    expect(v.facets.vision).toBe("unknown");
    expect(v.state).toBe("HEALTHY");
    expect(deriveVisionFacet({ detectionsLast10m: undefined })).toBe("unknown");
  });

  it("precedence: liveness, source and frames still come first; a frozen capture keeps its own reason", () => {
    expect(deriveCameraState(healthy({ ...blind, ageSeconds: 999 })).state).toBe("PRODUCER_OFFLINE");
    expect(deriveCameraState(healthy({ ...blind, sourceConnected: false })).state).toBe("CAMERA_OFFLINE");
    expect(deriveCameraState(healthy({ ...blind, poseOk: false })).state).toBe("CALIBRATION_INVALID");
    const frozen = deriveCameraState(healthy({ ...blind, frameOk: false }));
    expect(frozen.state).toBe("DEGRADED_VISION");
    expect(frozen.reason).toContain("frozen or looping");
    // Blind outranks a cloud backlog: the lot not being watched is the larger problem.
    expect(deriveCameraState(healthy({ ...blind, deadLetterDepth: 2 })).state).toBe("DEGRADED_VISION");
  });

  it("the interaction PTZ camera is never judged on vehicle detections", () => {
    const v = deriveCameraState(healthyInteraction({ ...blind }), "interaction_ptz");
    expect(v.state).toBe("HEALTHY");
    expect(v.facets.vision).toBe("not_required");
  });

  it("the ingest-time derivation carries the canary too, so a blind detector is a logged transition", () => {
    const { ageSeconds: _drop, ...rest } = healthy({ ...blind, ageSeconds: 0 });
    void _drop;
    expect(deriveStateAtIngest(rest).state).toBe("DEGRADED_VISION");
  });
});

describe("shopOpenAt reads BUSINESS.hours.structured in the shop's timezone", () => {
  // 2026-10-06 is a Tuesday; Cleveland is UTC-4 in October.
  it("open mid-morning on a weekday, closed after 6pm", () => {
    expect(shopOpenAt(new Date("2026-10-06T14:00:00Z"))).toBe(true);   // 10:00 ET
    expect(shopOpenAt(new Date("2026-10-06T23:00:00Z"))).toBe(false);  // 19:00 ET
    expect(shopOpenAt(new Date("2026-10-06T11:59:00Z"))).toBe(false);  // 07:59 ET
  });

  it("Sunday opens at 9, not 8", () => {
    expect(shopOpenAt(new Date("2026-10-04T12:30:00Z"))).toBe(false);  // 08:30 ET Sunday
    expect(shopOpenAt(new Date("2026-10-04T13:30:00Z"))).toBe(true);   // 09:30 ET Sunday
    expect(shopOpenAt(new Date("2026-10-04T20:30:00Z"))).toBe(false);  // 16:30 ET Sunday
  });
});

describe("camera health lattice — solar-aware expected offline (audit N3)", () => {
  const dark = { expectedOffline: true, reason: "solar camera: dark from civil dusk 19:25 until about 09:29 (sunrise 07:29 + 120 min) is expected" };
  const daylight = { expectedOffline: false, reason: "daylight" };

  it("a producer that aged out inside the window is EXPECTED_SOLAR_OFFLINE, facets untouched, loss still named", () => {
    const v = deriveCameraState(healthy({ ageSeconds: 900 }), "fixed_geometry", { solar: dark });
    expect(v.state).toBe("EXPECTED_SOLAR_OFFLINE");
    expect(v.facets.producer).toBe("offline");
    expect(v.reason).toContain("civil dusk");
    expect(v.reason).toContain("last heartbeat 900s ago");
  });

  it("a stale heartbeat and a disconnected source inside the window read the same way", () => {
    expect(deriveCameraState(healthy({ ageSeconds: 90 }), "fixed_geometry", { solar: dark }).state).toBe("EXPECTED_SOLAR_OFFLINE");
    expect(deriveCameraState(healthy({ sourceConnected: false }), "fixed_geometry", { solar: dark }).state).toBe("EXPECTED_SOLAR_OFFLINE");
  });

  it("the same loss in daylight, or with no solar context, is the fault it always was", () => {
    expect(deriveCameraState(healthy({ ageSeconds: 900 }), "fixed_geometry", { solar: daylight }).state).toBe("PRODUCER_OFFLINE");
    expect(deriveCameraState(healthy({ ageSeconds: 900 }), "fixed_geometry", null).state).toBe("PRODUCER_OFFLINE");
    expect(deriveCameraState(healthy({ ageSeconds: 900 })).state).toBe("PRODUCER_OFFLINE");
    expect(deriveCameraState(healthy({ sourceConnected: false }), "fixed_geometry", { solar: daylight }).state).toBe("CAMERA_OFFLINE");
  });

  it("an awake camera is judged exactly as before, whatever the sky says", () => {
    expect(deriveCameraState(healthy(), "fixed_geometry", { solar: dark }).state).toBe("HEALTHY");
    expect(deriveCameraState(healthy({ calibrationVersion: null }), "fixed_geometry", { solar: dark }).state).toBe("CALIBRATION_INVALID");
    expect(deriveCameraState(healthy({ frameOk: false }), "fixed_geometry", { solar: dark }).state).toBe("DEGRADED_VISION");
  });

  it("never-ingested and the PTZ office camera get no solar excuse", () => {
    expect(deriveCameraState(null, "fixed_geometry", { solar: dark }).state).toBe("NEVER_INGESTED");
    expect(deriveCameraState(healthyInteraction({ ageSeconds: 900 }), "interaction_ptz", { solar: dark }).state).toBe("PRODUCER_OFFLINE");
  });
});
