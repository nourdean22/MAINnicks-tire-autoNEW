/**
 * One verdict for "are the shop's cameras OK?", for every parent surface that rolls them up.
 *
 * WHY THIS EXISTS (2026-10-02 admin truth pass). `lot.health` already derives an honest
 * per-camera state (server/lib/cameraHealth.ts), but the parents above it never read it:
 * the Lot header said "Live" from visit freshness alone, and Settings -> Status said
 * "All clear" from eight checks none of which was a camera. Production had sign
 * CAMERA_OFFLINE, right CALIBRATION_INVALID and the office conversation worker STALE while
 * both parents were green.
 *
 * Rules:
 * - Only COMMISSIONED, registered cameras count. An uncommissioned camera renders muted on
 *   the Lot page by design and must not page anyone.
 * - An unregistered producer always counts: something is posting under the shop's key.
 * - A read that failed, or a payload we cannot interpret, is UNKNOWN — never HEALTHY.
 * - A commissioned camera whose interaction worker is stale/missing/erroring is DEGRADED
 *   even when its video state is HEALTHY: the worker is a declared child of that camera.
 */

export type CameraFleetState = "HEALTHY" | "DEGRADED" | "UNKNOWN";

export interface CameraFleetInputCamera {
  camera: string;
  label?: string | null;
  state: string;
  commissioned?: boolean | null;
  registered?: boolean | null;
  /** Interaction worker runtime, when the camera has one (lot.health `conversation`). */
  conversation?: {
    workerOk?: boolean | null;
    state?: string | null;
    /** Seconds since the worker last wrote its own status (lot.health `workerAgeSeconds`). */
    workerAgeSeconds?: number | null;
  } | null;
}

/**
 * A worker self-report older than this is not a report about now. The office worker writes
 * its status every ~30 s and the agent relays it on every heartbeat; on 2026-10-05/06 the
 * worker hung with "READY" on disk for hours while the agent kept relaying it, so the panel
 * and this verdict read a live state off a dead process.
 */
export const WORKER_STALE_AFTER_SECONDS = 120;

export interface CameraFleetProblem {
  camera: string;
  label: string;
  state: string;
}

export interface CameraFleetVerdict {
  state: CameraFleetState;
  /** Counted cameras (commissioned + unregistered). */
  counted: number;
  problems: CameraFleetProblem[];
  reason: string | null;
}

/** Same set the Lot page's Office panel paints red (LotSection.tsx OfficeIntelligence). */
const WORKER_BAD = new Set(["DEGRADED", "MISSING", "STALE", "ERROR", "STOPPED"]);

export function summarizeCameraFleet(
  payload: { ok: true; cameras: readonly CameraFleetInputCamera[] } | { ok: false; reason?: string } | null | undefined,
): CameraFleetVerdict {
  if (!payload) return { state: "UNKNOWN", counted: 0, problems: [], reason: "camera health not loaded" };
  if (payload.ok !== true) {
    return { state: "UNKNOWN", counted: 0, problems: [], reason: payload.reason ?? "camera health read failed" };
  }
  const counted = payload.cameras.filter((c) => c.registered === false || c.commissioned === true);
  if (counted.length === 0) {
    return { state: "UNKNOWN", counted: 0, problems: [], reason: "no commissioned camera reported" };
  }
  const problems: CameraFleetProblem[] = [];
  for (const c of counted) {
    const label = c.label || c.camera;
    if (c.registered === false) {
      problems.push({ camera: c.camera, label, state: `UNREGISTERED (${c.state})` });
      continue;
    }
    if (c.state !== "HEALTHY") {
      problems.push({ camera: c.camera, label, state: c.state });
      continue;
    }
    const worker = c.conversation;
    const workerState = worker?.state?.toUpperCase() ?? null;
    if (worker && (worker.workerOk === false || (workerState && WORKER_BAD.has(workerState)))) {
      problems.push({ camera: c.camera, label, state: `conversation worker ${workerState ?? "STOPPED"}` });
      continue;
    }
    const workerAge = worker?.workerAgeSeconds;
    if (worker && typeof workerAge === "number" && workerAge > WORKER_STALE_AFTER_SECONDS) {
      problems.push({
        camera: c.camera,
        label,
        state: `conversation worker STALE (last report ${Math.round(workerAge / 60)}m ago)`,
      });
    }
  }
  return {
    state: problems.length > 0 ? "DEGRADED" : "HEALTHY",
    counted: counted.length,
    problems,
    reason: problems.length > 0 ? problems.map((p) => `${p.label}: ${p.state}`).join(" · ") : null,
  };
}
