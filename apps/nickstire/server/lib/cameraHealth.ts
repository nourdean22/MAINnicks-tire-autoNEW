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
import type { CameraHealthProfile } from "../../shared/cameras";

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

  outboxDepth: number | null;
  oldestOutboxAgeSeconds: number | null;
  deadLetterDepth: number | null;
}

type RequirementFacet = "ok" | "down" | "unknown" | "not_required";
type HomeFacet = "ok" | "invalid" | "unknown" | "not_required";

interface HealthFacets {
  producer: "alive" | "stale" | "offline" | "never";
  source: "connected" | "disconnected" | "unknown" | "not_required";
  frames: "fresh" | "stale" | "unhealthy" | "unknown" | "not_required";
  pose: "ok" | "invalid" | "unknown" | "not_required";
  calibration: "valid" | "missing" | "not_required";
  auth: RequirementFacet;
  events: RequirementFacet;
  control: RequirementFacet;
  media: RequirementFacet;
  home: HomeFacet;
  cloud: "ok" | "backlog" | "dead_letters" | "unknown";
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
  const facets: HealthFacets = {
    producer,
    source,
    frames,
    pose,
    calibration,
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
