/**
 * Camera health LATTICE -> one user-facing state, without losing the dimensions.
 *
 * Every dimension is judged on its own and kept (`facets`); the headline `state`
 * is the FIRST failing dimension in a fixed precedence, so the operator reads one
 * word and the panel still shows why. Precedence, most fundamental first:
 *
 *   NEVER_INGESTED      no heartbeat has ever arrived for an expected camera
 *   PRODUCER_OFFLINE    heartbeat older than `offlineAfterSeconds`
 *   STALE               heartbeat older than `staleAfterSeconds` (not yet offline)
 *   CAMERA_OFFLINE      producer alive, no usable source / no healthy frame
 *   CALIBRATION_INVALID pixels exist, geometry cannot authorise an arrival
 *   DEGRADED_VISION     frames usable but the capture is frozen / looping
 *   CLOUD_BACKLOG       sensing fine, durable queue not draining
 *   HEALTHY
 *
 * Two rules the old visit-derived health could not honour:
 *   - a quiet lot is HEALTHY: zero visits never appears in this function;
 *   - nothing ever says HEALTHY while frames are stale, and frame age is judged
 *     against the PRODUCER's clock (`observedAtEdge`), so a late heartbeat does
 *     not make the frames look stale twice.
 *
 * All inputs are epoch seconds or plain values. Dates are parsed by SQL
 * (`UNIX_TIMESTAMP(...)`), never in JS: driver-parsed TiDB TIMESTAMPs are the
 * class of bug this app has already paid for.
 */

const CAMERA_STATES = [
  "NEVER_INGESTED",
  "PRODUCER_OFFLINE",
  "STALE",
  "CAMERA_OFFLINE",
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
  sourceConnected: boolean | null;
  lastHealthyFrameAtEpoch: number | null;
  frameOk: boolean | null;
  poseOk: boolean | null;
  calibrationVersion: string | null;
  outboxDepth: number | null;
  oldestOutboxAgeSeconds: number | null;
  deadLetterDepth: number | null;
}

interface HealthFacets {
  producer: "alive" | "stale" | "offline" | "never";
  source: "connected" | "disconnected" | "unknown";
  frames: "fresh" | "stale" | "unhealthy" | "unknown";
  pose: "ok" | "invalid" | "unknown";
  calibration: "valid" | "missing";
  cloud: "ok" | "backlog" | "dead_letters" | "unknown";
}

interface HealthVerdict {
  state: CameraState;
  facets: HealthFacets;
  /** One sentence naming the failing dimension, for the panel and the event log. */
  reason: string;
}

export function deriveCameraState(r: RuntimeSnapshot | null): HealthVerdict {
  if (r === null || r.receivedAtEpoch === null) {
    return {
      state: "NEVER_INGESTED",
      facets: { producer: "never", source: "unknown", frames: "unknown", pose: "unknown", calibration: "missing", cloud: "unknown" },
      reason: "no heartbeat has ever been received for this camera",
    };
  }
  const T = HEALTH_THRESHOLDS;
  const age = r.ageSeconds;

  const producer: HealthFacets["producer"] =
    age === null ? "stale" : age > T.offlineAfterSeconds ? "offline" : age > T.staleAfterSeconds ? "stale" : "alive";

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

  let cloud: HealthFacets["cloud"] = "unknown";
  if (r.deadLetterDepth !== null && r.deadLetterDepth > 0) cloud = "dead_letters";
  else if (r.oldestOutboxAgeSeconds !== null && r.oldestOutboxAgeSeconds > T.backlogWarnSeconds) cloud = "backlog";
  else if (r.outboxDepth !== null || r.oldestOutboxAgeSeconds !== null) cloud = "ok";

  const facets: HealthFacets = { producer, source, frames, pose, calibration, cloud };

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
  return { state: "HEALTHY", facets, reason: "producer, source, frames, pose, calibration and delivery inside SLO" };
}

/**
 * The state the INGEST records from a heartbeat it has just received: liveness is
 * trivially alive at that instant, so age is 0 by construction. The read side
 * re-derives with the real age.
 */
export function deriveStateAtIngest(r: Omit<RuntimeSnapshot, "ageSeconds">): HealthVerdict {
  return deriveCameraState({ ...r, ageSeconds: 0 });
}
