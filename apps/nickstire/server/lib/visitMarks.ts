/**
 * What the operator's marks say about one visit, derived from the camera's clocks and the
 * mark history together (migration 0145; camera audit 2026-10-07, N1).
 *
 * Rules, each the reason this is a function and not four SQL columns:
 *
 * - Service STARTS at the earlier of the camera's bay entry and a SERVICE_STARTED mark. A car
 *   worked on in the lot has no bay entry and would otherwise never start.
 * - Service is DONE at the latest SERVICE_DONE mark, unless a later SERVICE_STARTED reopened
 *   it (the car came back onto the lift). A done car still on the property is PICKUP PENDING,
 *   and the pickup wait is measured from that mark.
 * - A camera-started service with no tap about it ENDS when the camera sees the car leave the
 *   bay: the two clocks on one card (bay time, service time) must not disagree.
 * - CUSTOMER_WAITING is a fact about the visit, true until the car leaves.
 * - NOT_A_JOB removes the visit from every service clock: no start, no done, no pickup. The
 *   car is still on the lot (occupancy is a camera fact), it is just not a customer's job.
 * - CLEARED is the undo. Rows are append-only, so a mis-tap is reversed by appending CLEARED;
 *   only marks after the last CLEARED are in force. The history keeps the mistake.
 * - An unmarked car is UNKNOWN on every mark-derived field. Null means "nobody said", never 0.
 * - A mark string this build does not know (a future vocabulary entry read by an older
 *   server) is ignored, not an error: the floor board must keep rendering.
 *
 * Pure: epoch milliseconds in, plain values out. The router fetches `UNIX_TIMESTAMP(col) * 1000`
 * for every clock so no driver time-zone shift reaches this code (AGENTS.md: driver-parsed
 * TiDB timestamps come back shifted on ET).
 */
import { isVisitMark, type VisitMark, type VisitMarkState } from "../../shared/visitMarks";

export type { VisitMarkState } from "../../shared/visitMarks";

export type VisitMarkRow = { mark: string; markedAtMs: number; note: string | null };

export type VisitClocks = {
  bayEnteredAtMs: number | null;
  /** Optional for callers that only know the entry; absent reads as "still in the bay or never in one". */
  bayExitedAtMs?: number | null;
  departedAtMs: number | null;
};

const minutesBetween = (fromMs: number, toMs: number): number => Math.max(0, Math.floor((toMs - fromMs) / 60_000));

export function deriveVisitMarkState(visit: VisitClocks, marks: readonly VisitMarkRow[], nowMs: number): VisitMarkState {
  const understood = marks
    .filter((m): m is VisitMarkRow & { mark: VisitMark } => isVisitMark(m.mark) && Number.isFinite(m.markedAtMs))
    .sort((a, b) => a.markedAtMs - b.markedAtMs);
  // Only marks after the last CLEARED are in force.
  let lastClear = -1;
  understood.forEach((m, i) => { if (m.mark === "CLEARED") lastClear = i; });
  const known = understood.slice(lastClear + 1);

  const departed = visit.departedAtMs !== null;
  const endMs = visit.departedAtMs ?? nowMs;

  const last = known.length ? known[known.length - 1] : null;
  const latest = last ? { mark: last.mark, atMs: last.markedAtMs, note: last.note } : null;
  const notAJob = known.some((m) => m.mark === "NOT_A_JOB");
  const customerWaiting = !departed && known.some((m) => m.mark === "CUSTOMER_WAITING");

  if (notAJob) {
    return {
      latest,
      customerWaiting,
      notAJob: true,
      serviceStartedAtMs: null,
      serviceStartedBy: null,
      serviceDoneAtMs: null,
      serviceEndedAtMs: null,
      serviceRunning: false,
      serviceMinutes: null,
      pickupPending: false,
      pickupWaitMinutes: null,
      markCount: known.length,
    };
  }

  const startedMarks = known.filter((m) => m.mark === "SERVICE_STARTED");
  const firstStartMark = startedMarks.length ? startedMarks[0].markedAtMs : null;
  let serviceStartedAtMs: number | null = null;
  let serviceStartedBy: VisitMarkState["serviceStartedBy"] = null;
  if (visit.bayEnteredAtMs !== null && (firstStartMark === null || visit.bayEnteredAtMs <= firstStartMark)) {
    serviceStartedAtMs = visit.bayEnteredAtMs;
    serviceStartedBy = "camera";
  } else if (firstStartMark !== null) {
    serviceStartedAtMs = firstStartMark;
    serviceStartedBy = "mark";
  }

  const doneMarks = known.filter((m) => m.mark === "SERVICE_DONE");
  const lastDone = doneMarks.length ? doneMarks[doneMarks.length - 1].markedAtMs : null;
  const lastStartMark = startedMarks.length ? startedMarks[startedMarks.length - 1].markedAtMs : null;
  // A SERVICE_STARTED after the last SERVICE_DONE reopens the job -- and so does the camera
  // seeing the car enter a bay after the done mark: a car back on a lift is not waiting for pickup.
  const reopenedByMark = lastStartMark !== null && lastDone !== null && lastStartMark > lastDone;
  const reopenedByCamera = lastDone !== null && visit.bayEnteredAtMs !== null && visit.bayEnteredAtMs > lastDone;
  const serviceDoneAtMs = lastDone !== null && !reopenedByMark && !reopenedByCamera ? lastDone : null;

  // The camera's own end of a camera-started service: the car left the bay and nobody tapped
  // anything about the service. A SERVICE_STARTED tap means a person owns the clock instead.
  const bayExitedAtMs = visit.bayExitedAtMs ?? null;
  const serviceEndedAtMs =
    serviceStartedBy === "camera" && startedMarks.length === 0 && serviceDoneAtMs === null &&
    bayExitedAtMs !== null && serviceStartedAtMs !== null && bayExitedAtMs >= serviceStartedAtMs
      ? bayExitedAtMs
      : null;

  // Null, never a confident 0, when the inputs contradict (a done mark before any start).
  const serviceStopMs = serviceDoneAtMs ?? serviceEndedAtMs ?? endMs;
  const serviceMinutes =
    serviceStartedAtMs === null || serviceStopMs < serviceStartedAtMs ? null : minutesBetween(serviceStartedAtMs, serviceStopMs);
  const serviceRunning = serviceStartedAtMs !== null && serviceDoneAtMs === null && serviceEndedAtMs === null && !departed;
  const pickupPending = serviceDoneAtMs !== null && !departed;
  const pickupWaitMinutes = serviceDoneAtMs === null ? null : minutesBetween(serviceDoneAtMs, endMs);

  return {
    latest,
    customerWaiting,
    notAJob: false,
    serviceStartedAtMs,
    serviceStartedBy,
    serviceDoneAtMs,
    serviceEndedAtMs,
    serviceRunning,
    serviceMinutes,
    pickupPending,
    pickupWaitMinutes,
    markCount: known.length,
  };
}
