/**
 * Device status from WORK counters, not heartbeat arrival · 2026-10-30.
 *
 * The lot edge PATCHes /api/devices/:id every beat with running totals (frames decoded,
 * detections, arrivals). A heartbeat thread beside the work proves only that the process
 * exists, so this derives status from the frame total ADVANCING: frames moving -> ONLINE and
 * lastSeenAt moves; frames flat for WORK_STALL_BEATS beats -> ERROR (the existing status word
 * for "reporting but not working"), and lastSeenAt stays at the last beat that did work.
 * A quiet lot is healthy: crossings are reported, never used for status.
 * Benchmark: shop-camera-best-in-class mechanisms.md "Progress watchdog" row + its Liveness rule.
 */
import { ServiceError } from "@/lib/utils/service-error";

export const EDGE_WORK_KIND = "edge-work-v1";
/** Flat beats before ERROR. At the edge's 30 s beat this is about 90 s of no decoded frames. */
export const WORK_STALL_BEATS = 3;

export type EdgeWork = {
  kind: typeof EDGE_WORK_KIND;
  producerInstanceId: string;
  heartbeatSeq: number;
  framesTotal: number;
  [key: string]: unknown;
};

export type EdgeWorkState = EdgeWork & {
  flatBeats: number;
  workStallSince: string | null;
  lastBeatAt: string;
};

export function isEdgeWork(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { kind?: unknown }).kind === EDGE_WORK_KIND;
}

export function parseEdgeWork(value: unknown): EdgeWork {
  const v = (value ?? {}) as Record<string, unknown>;
  const frames = v.framesTotal;
  if (v.kind !== EDGE_WORK_KIND) throw new ServiceError("not an edge work heartbeat", 400);
  if (typeof v.producerInstanceId !== "string" || !v.producerInstanceId) {
    throw new ServiceError("producerInstanceId required", 400);
  }
  if (typeof frames !== "number" || !Number.isInteger(frames) || frames < 0) {
    throw new ServiceError("framesTotal must be a non-negative integer", 400);
  }
  const seq = typeof v.heartbeatSeq === "number" && Number.isFinite(v.heartbeatSeq) ? v.heartbeatSeq : 0;
  // Frames a blind-frame gate suppressed were decoded but could not be counted on, so they
  // are not work: a counter that sees only blind frames reads as stalled, not online.
  const suppressed = v.suppressedFramesTotal && typeof v.suppressedFramesTotal === "object"
    ? Object.values(v.suppressedFramesTotal as Record<string, unknown>)
        .reduce<number>((sum, n) => sum + (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0), 0)
    : 0;
  return {
    ...v,
    kind: EDGE_WORK_KIND,
    producerInstanceId: v.producerInstanceId,
    heartbeatSeq: seq,
    framesTotal: frames,
    usableFramesTotal: Math.max(0, frames - suppressed),
  };
}

/**
 * `status` / `lastSeenAt` undefined means "leave the column as it is".
 * Work = usable frames (decoded minus blind-gate suppressed) advancing. A new producerInstanceId
 * resets the frame baseline to 0 (a restarted edge's totals start over), but the flat-beat run
 * carries across restarts, so an edge that keeps restarting without decoding still reaches ERROR.
 */
export function deriveWorkStatus(
  prevStatus: string | null | undefined,
  prevState: unknown,
  next: EdgeWork,
  now: Date,
): { status: string | undefined; lastSeenAt: Date | undefined; currentState: EdgeWorkState } {
  const prev = isEdgeWork(prevState) ? (prevState as Partial<EdgeWorkState>) : null;
  const sameInstance = !!prev && prev.producerInstanceId === next.producerInstanceId;
  const usable = typeof next.usableFramesTotal === "number" ? next.usableFramesTotal : next.framesTotal;
  const baseline = sameInstance && typeof prev!.usableFramesTotal === "number" ? prev!.usableFramesTotal : 0;
  const advanced = usable > baseline;
  const flatBeats = advanced ? 0 : (prev ? Number(prev.flatBeats) || 0 : 0) + 1;
  const workStallSince = advanced
    ? null
    : (prev && typeof prev.workStallSince === "string" ? prev.workStallSince : now.toISOString());

  let status: string | undefined;
  if (advanced) status = "ONLINE";
  else if (flatBeats >= WORK_STALL_BEATS && prevStatus !== "ERROR") status = "ERROR";

  return {
    status,
    lastSeenAt: advanced ? now : undefined,
    currentState: { ...next, flatBeats, workStallSince, lastBeatAt: now.toISOString() },
  };
}
