/**
 * Camera health LATTICE -> one user-facing state, without losing the dimensions.
 *
 * Camera role changes what "healthy" means:
 *
 * fixed_geometry
 *   producer -> source -> frames -> pose/calibration -> vision -> cloud
 *
 * interaction_ptz
 *   producer -> auth -> semantic events -> P2P control -> media -> home pose -> cloud
 *
 * A movable office camera is deliberately NOT judged on vehicle calibration, and a fixed
 * vehicle-truth camera is deliberately NOT judged on PTZ. This keeps authority aligned
 * with the job each camera is allowed to do.
 */
import { BUSINESS } from "../../shared/business";
import type { CameraHealthProfile } from "../../shared/cameras";
import { businessState } from "../../shared/shopState";

/**
 * Whether the shop is open at `now`, per BUSINESS.hours.structured in the shop's timezone.
 * The plausibility canary's `shopOpen` input, computed by every caller the same way so the
 * ingest-time state, the Lot read and the alert cron cannot disagree about "open".
 */
export function shopOpenAt(now: Date = new Date()): boolean {
  return businessState(now, BUSINESS.timezone, BUSINESS.hours.structured).state === "open";
}

const CAMERA_STATES = [
  "NEVER_INGESTED",
  "PRODUCER_OFFLINE",
  "STALE",
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
  "HEALTHY",
] as const;
type CameraState = (typeof CAMERA_STATES)[number];

/** Initial SLO thresholds: proposed, not yet measured against a 30-day run. */
export const HEALTH_THRESHOLDS = {
  /** Heartbeat cadence the producers are configured for. */
  heartbeatSeconds: 30,
  staleAfterSeconds: 60,
  offlineAfterSeconds: 120,
  /** A healthy frame older than this (on the producer's clock) means no usable source. */
  frameStaleAfterSeconds: 15,
  backlogWarnSeconds: 60,
  /**
   * Plausibility (audit 2026-10-07). `detectionsLast10m` is a 600 s window on the edge
   * (edge_main.DETECTIONS_WINDOW_SECONDS); a zero in it is only evidence of blindness when
   * the detector actually ran inside that window, so the inference age must be under the
   * same 600 s.
   */
  blindInferenceMaxAgeSeconds: 600,
} as const;

interface RuntimeSnapshot {
  /** Seconds since the cloud received the last heartbeat; null when never. */
  ageSeconds: number | null;
  /** Producer clock at heartbeat time, epoch seconds. */
  observedAtEdgeEpoch: number | null;
  receivedAtEpoch: number | null;

  /** Fixed-geometry / generic capture dimensions. */
  sourceConnected: boolean | null;
  lastHealthyFrameAtEpoch: number | null;
  frameOk: boolean | null;
  poseOk: boolean | null;
  calibrationVersion: string | null;

  /** Interaction/PTZ transport dimensions. Null means NOT PROVEN, never success. */
  authPlaneOk?: boolean | null;
  eventPlaneOk?: boolean | null;
  controlPlaneOk?: boolean | null;
  mediaPlaneOk?: boolean | null;
  ptzHomeOk?: boolean | null;

  /**
   * What the detector SAW (migration 0143), for the plausibility facet. All optional and
   * nullable: a producer that keeps no window reports nothing, and nothing is not zero.
   */
  detectionsLast10m?: number | null;
  portalCrossingsLast60m?: number | null;
  /** Seconds since the detector last ran, on the reader's clock. */
  inferenceAgeSeconds?: number | null;
  /** Whether the shop is open at evaluation time (BUSINESS hours, shop timezone). */
  shopOpen?: boolean | null;

  outboxDepth: number | null;
  oldestOutboxAgeSeconds: number | null;
  deadLetterDepth: number | null;
}

type RequirementFacet = "ok" | "down" | "unknown" | "not_required";
type HomeFacet = "ok" | "invalid" | "unknown" | "not_required";
/**
 * seeing  -- the detector saw at least one vehicle in the last 10 minutes.
 * blind   -- it ran inside the window, saw NO vehicle for 10 minutes, no car crossed the
 *            portal for 60, and the shop is open. A tire shop's lot is not empty of
 *            vehicles for ten minutes of business; the camera is not watching the lot.
 * quiet   -- it saw nothing, and nothing says it should have: no inference inside the
 *            window (the motion gate stayed shut), a recent crossing, or the shop closed.
 * unknown -- the producer does not report the window (pre-0143 edge).
 */
type VisionFacet = "seeing" | "blind" | "quiet" | "unknown" | "not_required";

interface HealthFacets {
  producer: "alive" | "stale" | "offline" | "never";
  source: "connected" | "disconnected" | "unknown" | "not_required";
  frames: "fresh" | "stale" | "unhealthy" | "unknown" | "not_required";
  pose: "ok" | "invalid" | "unknown" | "not_required";
  calibration: "valid" | "missing" | "not_required";
  vision: VisionFacet;
  auth: RequirementFacet;
  events: RequirementFacet;
  control: RequirementFacet;
  media: RequirementFacet;
  home: HomeFacet;
  cloud: "ok" | "backlog" | "dead_letters" | "unknown";
}

/**
 * Plausibility, judged only when the camera is otherwise delivering frames. This is a
 * canary, not a required capability: `unknown` never blocks HEALTHY, because every edge
 * that predates 0143 reports nothing here and a "fresh heartbeat is not proof" rule that
 * paged UNVERIFIED for a missing counter would page the owner about the deploy, not the lot.
 */
function deriveVisionFacet(r: Pick<RuntimeSnapshot,
  "detectionsLast10m" | "portalCrossingsLast60m" | "inferenceAgeSeconds" | "shopOpen">): VisionFacet {
  const detections = r.detectionsLast10m;
  if (detections === null || detections === undefined) return "unknown";
  if (detections > 0) return "seeing";
  const inferredInWindow =
    r.inferenceAgeSeconds !== null && r.inferenceAgeSeconds !== undefined &&
    r.inferenceAgeSeconds <= HEALTH_THRESHOLDS.blindInferenceMaxAgeSeconds;
  if (!inferredInWindow) return "quiet";
  if (r.portalCrossingsLast60m !== 0) return "quiet";
  if (r.shopOpen !== true) return "quiet";
  return "blind";
}

interface HealthVerdict {
  state: CameraState;
  facets: HealthFacets;
  /** One sentence naming the failing dimension, for the panel and the event log. */
  reason: string;
}

function requirement(value: boolean | null | undefined): RequirementFacet {
  return value === true ? "ok" : value === false ? "down" : "unknown";
}

function homeRequirement(value: boolean | null | undefined): HomeFacet {
  return value === true ? "ok" : value === false ? "invalid" : "unknown";
}

function neverFacets(profile: CameraHealthProfile): HealthFacets {
  const interaction = profile === "interaction_ptz";
  return {
    producer: "never",
    source: interaction ? "not_required" : "unknown",
    frames: interaction ? "not_required" : "unknown",
    pose: interaction ? "not_required" : "unknown",
    calibration: interaction ? "not_required" : "missing",
    vision: interaction ? "not_required" : "unknown",
    auth: interaction ? "unknown" : "not_required",
    events: interaction ? "unknown" : "not_required",
    control: interaction ? "unknown" : "not_required",
    media: interaction ? "unknown" : "not_required",
    home: interaction ? "unknown" : "not_required",
    cloud: "unknown",
  };
}

export function deriveCameraState(
  r: RuntimeSnapshot | null,
  profile: CameraHealthProfile = "fixed_geometry",
): HealthVerdict {
  if (r === null || r.receivedAtEpoch === null) {
    return {
      state: "NEVER_INGESTED",
      facets: neverFacets(profile),
      reason: "no heartbeat has ever been received for this camera",
    };
  }
  const T = HEALTH_THRESHOLDS;
  const age = r.ageSeconds;

  const producer: HealthFacets["producer"] =
    age === null ? "stale" : age > T.offlineAfterSeconds ? "offline" : age > T.staleAfterSeconds ? "stale" : "alive";

  let cloud: HealthFacets["cloud"] = "unknown";
  // Real producer semantics: an EMPTY outbox has no oldest row, so
  // oldestOutboxAgeSeconds=null is the correct/healthy representation when depth=0.
  // For a NON-empty queue, age must be measured before delivery health is proven.
  const queueProofComplete =
    r.outboxDepth !== null &&
    r.deadLetterDepth !== null &&
    (r.outboxDepth === 0 || r.oldestOutboxAgeSeconds !== null);
  if (r.deadLetterDepth !== null && r.deadLetterDepth > 0) cloud = "dead_letters";
  else if (
    r.outboxDepth !== null &&
    r.outboxDepth > 0 &&
    r.oldestOutboxAgeSeconds !== null &&
    r.oldestOutboxAgeSeconds > T.backlogWarnSeconds
  ) cloud = "backlog";
  else if (queueProofComplete) cloud = "ok";

  if (profile === "interaction_ptz") {
    const facets: HealthFacets = {
      producer,
      source: "not_required",
      frames: "not_required",
      pose: "not_required",
      calibration: "not_required",
      vision: "not_required",
      auth: requirement(r.authPlaneOk),
      events: requirement(r.eventPlaneOk),
      control: requirement(r.controlPlaneOk),
      media: requirement(r.mediaPlaneOk),
      home: homeRequirement(r.ptzHomeOk),
      cloud,
    };

    if (producer === "offline") {
      return { state: "PRODUCER_OFFLINE", facets, reason: `last heartbeat ${Math.round(age ?? 0)}s ago (offline after ${T.offlineAfterSeconds}s)` };
    }
    if (producer === "stale") {
      return { state: "STALE", facets, reason: age === null ? "heartbeat age unknown" : `last heartbeat ${Math.round(age)}s ago (stale after ${T.staleAfterSeconds}s)` };
    }
    if (facets.auth === "down") {
      return { state: "AUTH_DEGRADED", facets, reason: "Eufy bridge is reachable but its authenticated control session is not healthy" };
    }
    if (facets.events === "down") {
      return { state: "EVENTS_DEGRADED", facets, reason: "semantic motion/person event stream is disconnected" };
    }
    if (facets.control === "down") {
      return { state: "CONTROL_DEGRADED", facets, reason: "PTZ/P2P control has a measured failure" };
    }
    if (facets.media === "down") {
      return { state: "MEDIA_DEGRADED", facets, reason: "camera media path has a measured failure" };
    }
    if (facets.home === "invalid") {
      return { state: "PTZ_HOME_INVALID", facets, reason: "PTZ moved but has not been proven back at the calibrated home view" };
    }
    if (cloud === "dead_letters" || cloud === "backlog") {
      return {
        state: "CLOUD_BACKLOG",
        facets,
        reason: cloud === "dead_letters"
          ? `${r.deadLetterDepth} dead-lettered event(s) need attention`
          : `oldest unsent event is ${r.oldestOutboxAgeSeconds}s old`,
      };
    }

    const required = [facets.auth, facets.events, facets.control, facets.media, facets.home];
    if (required.includes("unknown")) {
      return {
        state: "UNVERIFIED_CAPABILITIES",
        facets,
        reason: "one or more required interaction-camera planes have not been physically proven yet",
      };
    }
    return {
      state: "HEALTHY",
      facets,
      reason: "producer, auth, events, P2P control, media, PTZ home and delivery are proven healthy",
    };
  }

  const source: HealthFacets["source"] =
    r.sourceConnected === null ? "unknown" : r.sourceConnected ? "connected" : "disconnected";

  // Frame age on the PRODUCER's clock. Fall back to receivedAt only when the
  // producer did not stamp its own time.
  const edgeNow = r.observedAtEdgeEpoch ?? r.receivedAtEpoch;
  let frames: HealthFacets["frames"] = "unknown";
  if (r.lastHealthyFrameAtEpoch !== null && edgeNow !== null) {
    const frameAge = edgeNow - r.lastHealthyFrameAtEpoch;
    frames = frameAge > T.frameStaleAfterSeconds ? "stale" : r.frameOk === false ? "unhealthy" : "fresh";
  } else if (r.frameOk === false) {
    frames = "unhealthy";
  } else if (r.frameOk === true) {
    frames = "fresh";
  }

  const pose: HealthFacets["pose"] = r.poseOk === null ? "unknown" : r.poseOk ? "ok" : "invalid";
  const calibration: HealthFacets["calibration"] = r.calibrationVersion ? "valid" : "missing";
  const vision = deriveVisionFacet(r);
  const facets: HealthFacets = {
    producer,
    source,
    frames,
    pose,
    calibration,
    vision,
    auth: "not_required",
    events: "not_required",
    control: "not_required",
    media: "not_required",
    home: "not_required",
    cloud,
  };

  if (producer === "offline") {
    return { state: "PRODUCER_OFFLINE", facets, reason: `last heartbeat ${Math.round(age ?? 0)}s ago (offline after ${T.offlineAfterSeconds}s)` };
  }
  if (producer === "stale") {
    return { state: "STALE", facets, reason: age === null ? "heartbeat age unknown" : `last heartbeat ${Math.round(age)}s ago (stale after ${T.staleAfterSeconds}s)` };
  }
  if (source === "disconnected" || frames === "stale") {
    return {
      state: "CAMERA_OFFLINE",
      facets,
      reason: source === "disconnected"
        ? "producer alive but its capture source is disconnected"
        : `no healthy frame for more than ${T.frameStaleAfterSeconds}s on the producer's clock`,
    };
  }
  if (pose === "invalid" || calibration === "missing") {
    return {
      state: "CALIBRATION_INVALID",
      facets,
      reason: pose === "invalid"
        ? "camera pose does not match the trusted reference; arrivals are not authorised"
        : "no calibration: census mode, arrivals are not authorised",
    };
  }
  if (frames === "unhealthy") {
    return { state: "DEGRADED_VISION", facets, reason: "capture is frozen or looping; detections are suppressed" };
  }
  if (vision === "blind") {
    // The 2026-10-05 shape: frames fresh, detector running, four arrivals on a forty-car
    // day, every surface green. Same state as a frozen capture because the consequence is
    // the same -- the lot is not being watched -- with a reason that names the evidence.
    return {
      state: "DEGRADED_VISION",
      facets,
      reason: `detector ran ${Math.round(r.inferenceAgeSeconds ?? 0)}s ago but saw no vehicle for 10 min and no portal crossing for 60 min during business hours; the lot is not being watched`,
    };
  }
  if (cloud === "dead_letters" || cloud === "backlog") {
    return {
      state: "CLOUD_BACKLOG",
      facets,
      reason: cloud === "dead_letters"
        ? `${r.deadLetterDepth} dead-lettered event(s) need attention`
        : `oldest unsent event is ${r.oldestOutboxAgeSeconds}s old`,
    };
  }

  // A fresh heartbeat is not proof that a fixed camera is healthy. Vehicle-truth
  // authority requires positive evidence for source, frames, pose/calibration and
  // delivery. Missing telemetry stays visibly unverified instead of silently
  // becoming HEALTHY (which could also emit a false recovery).
  if (
    source === "unknown" ||
    frames === "unknown" ||
    pose === "unknown" ||
    cloud === "unknown"
  ) {
    return {
      state: "UNVERIFIED_CAPABILITIES",
      facets,
      reason: "one or more required fixed-camera health facets have not been proven yet",
    };
  }

  return {
    state: "HEALTHY",
    facets,
    reason: "producer, source, frames, pose, calibration and delivery inside SLO",
  };
}

/**
 * The state the INGEST records from a heartbeat it has just received: liveness is
 * trivially alive at that instant, so age is 0 by construction. The read side
 * re-derives with the real age.
 */
export function deriveStateAtIngest(
  r: Omit<RuntimeSnapshot, "ageSeconds">,
  profile: CameraHealthProfile = "fixed_geometry",
): HealthVerdict {
  return deriveCameraState({ ...r, ageSeconds: 0 }, profile);
}
