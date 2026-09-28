/**
 * Authority rules for the production sign camera.
 *
 * A fresh healthy RTSP producer is authoritative for a short lease. Legacy WGC/window
 * producers may take over only after that lease expires or RTSP degrades. Production visit
 * writes are additionally fenced by the active calibration hash so an old producer cannot
 * keep writing visits while the RTSP runtime owns the camera.
 */
const SIGN_RTSP_AUTHORITY_FRESH_MS = 90_000;

type CameraAuthoritySnapshot = {
  sourceType?: unknown;
  calibrationVersion?: unknown;
  receivedAt?: unknown;
  state?: unknown;
};

type HeartbeatAuthorityCandidate = {
  camera?: unknown;
  sourceType?: unknown;
};

type VisitAuthorityCandidate = {
  camera?: unknown;
  dataClass?: unknown;
  calibrationVersion?: unknown;
};

function authorityReceivedAtMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" && Number.isFinite(v)) return v > 1_000_000_000_000 ? v : v * 1000;
  if (typeof v === "string" && v.trim()) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function isFreshHealthyRtspAuthority(
  current: CameraAuthoritySnapshot | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!current || String(current.sourceType ?? "").toLowerCase() !== "rtsp") return false;
  if (String(current.state ?? "") !== "HEALTHY") return false;
  const receivedAtMs = authorityReceivedAtMs(current.receivedAt);
  if (receivedAtMs == null) return false;
  const age = nowMs - receivedAtMs;
  return age >= 0 && age <= SIGN_RTSP_AUTHORITY_FRESH_MS;
}

export function shouldBlockHeartbeatTakeover(
  current: CameraAuthoritySnapshot | null | undefined,
  incoming: HeartbeatAuthorityCandidate,
  nowMs = Date.now(),
): boolean {
  if (String(incoming.camera ?? "") !== "sign") return false;
  if (!isFreshHealthyRtspAuthority(current, nowMs)) return false;
  return String(incoming.sourceType ?? "").toLowerCase() !== "rtsp";
}

export function shouldBlockVisitOutsideAuthority(
  current: CameraAuthoritySnapshot | null | undefined,
  incoming: VisitAuthorityCandidate,
  nowMs = Date.now(),
): boolean {
  if (String(incoming.camera ?? "") !== "sign") return false;
  if (String(incoming.dataClass ?? "PRODUCTION") !== "PRODUCTION") return false;
  if (!isFreshHealthyRtspAuthority(current, nowMs)) return false;
  const activeCalibration = String(current?.calibrationVersion ?? "");
  if (!activeCalibration) return false;
  return String(incoming.calibrationVersion ?? "") !== activeCalibration;
}

export type { CameraAuthoritySnapshot };
