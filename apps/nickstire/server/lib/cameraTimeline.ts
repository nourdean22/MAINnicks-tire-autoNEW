/**
 * server/lib/cameraTimeline.ts -- a camera's day as STATE SEGMENTS, and how much of the shop's
 * business time the vehicle-truth camera actually watched (camera audit 2026-10-07, N2 + N6).
 *
 * The input is `camera_health_events`, which holds TRANSITIONS only. Until this module it had
 * one writer, the heartbeat ingest, which logs the producer's own state changes. It cannot log
 * STALE, PRODUCER_OFFLINE or EXPECTED_SOLAR_OFFLINE: those are derived at read time from the
 * age of the last heartbeat (or the sky), and no heartbeat arrives to log them. So the table
 * read HEALTHY straight through every outage, and "steady today" on the Lot card was a claim
 * about the rows, not about the camera. Two writers close that gap:
 *
 *  - the 5-minute alert pass writes a row whenever the state it DERIVES differs from the last
 *    row recorded (`derivedTransition`);
 *  - the heartbeat ingest writes the moment a producer RESUMES after one of those read-derived
 *    states (`resumptionTransition`), so the recovery is timed to the heartbeat, not to the
 *    next 5-minute tick.
 *
 * Two writers can race on the same transition; a duplicate row with the same `toState` is
 * merged here, never counted twice. Everything in this file is pure: the router feeds it the
 * day's rows plus the one row before the day (the anchor), the Lot page renders the result.
 */

export interface HealthEventRow {
  toState: string;
  fromState: string | null;
  reason: string | null;
  atMs: number;
}

export interface TimelineSegment {
  state: string;
  fromMs: number;
  /** When the next segment began, or `nowMs` for the segment still in force. */
  toMs: number;
  /** True for the segment still in force at `nowMs`. */
  open: boolean;
  reason: string | null;
}

export interface CameraTimeline {
  /** False when nothing was recorded before the day began: the day then opens on UNKNOWN. */
  anchorKnown: boolean;
  /** Contiguous from the start of the day to `nowMs`, in time order; never empty. */
  segments: TimelineSegment[];
  /** The state in force at `nowMs` and since when (the real start, which may predate the day); null when nothing is known. */
  current: { state: string; sinceMs: number; forSeconds: number } | null;
}

/** The state of a stretch of the day for which no row says anything. Never counted as watched. */
const UNKNOWN_STATE = "UNKNOWN";

/** States the READ side derives from heartbeat age or the sky; the producer never reports them. */
const READ_DERIVED_STATES: ReadonlySet<string> = new Set(["STALE", "PRODUCER_OFFLINE", "EXPECTED_SOLAR_OFFLINE"]);

/** The one state in which the lot is being watched. Every other state is time the counts did not see. */
const WATCHING_STATE = "HEALTHY";

export function buildCameraTimeline(input: {
  anchor: HealthEventRow | null;
  events: readonly HealthEventRow[];
  dayStartMs: number;
  nowMs: number;
}): CameraTimeline {
  const { anchor, dayStartMs, nowMs } = input;
  const events = input.events
    .filter((e) => e.atMs >= dayStartMs && e.atMs <= nowMs)
    .slice()
    .sort((a, b) => a.atMs - b.atMs);

  const segments: TimelineSegment[] = [];
  let state = anchor ? anchor.toState : UNKNOWN_STATE;
  let reason: string | null = anchor ? anchor.reason : null;
  let segmentFrom = dayStartMs;
  // The real start of the current state, which for an anchored day predates the day itself.
  let currentSince = anchor ? anchor.atMs : dayStartMs;
  let known = anchor !== null;

  for (const e of events) {
    // Two writers logging the same transition (the 5-minute pass and the ingest racing on a
    // recovery) produce two rows with one `toState`; the second says nothing new.
    if (e.toState === state) continue;
    if (e.atMs > segmentFrom) segments.push({ state, fromMs: segmentFrom, toMs: e.atMs, open: false, reason });
    state = e.toState;
    reason = e.reason;
    segmentFrom = e.atMs;
    currentSince = e.atMs;
    known = true;
  }
  segments.push({ state, fromMs: segmentFrom, toMs: Math.max(nowMs, segmentFrom), open: true, reason });

  return {
    anchorKnown: anchor !== null,
    segments,
    current: known
      ? { state, sinceMs: currentSince, forSeconds: Math.max(0, Math.round((nowMs - currentSince) / 1000)) }
      : null,
  };
}

export interface CoverageHour {
  startMs: number;
  endMs: number;
  /** Business time in this hour that has already passed by `nowMs`; 0 before the hour starts. */
  elapsedMs: number;
  watchedMs: number;
  /** Elapsed time no row covers (an unanchored morning); counted as not watched, reported apart. */
  unknownMs: number;
  /** watched / elapsed, or null while nothing of the hour has passed. */
  pct: number | null;
}

export interface BusinessCoverage {
  hours: CoverageHour[];
  elapsedMs: number;
  watchedMs: number;
  unknownMs: number;
  /** watched / elapsed over the whole business day so far, or null before it opens. */
  pct: number | null;
}

/** Whole clock hours from open to close; the last window is shorter when the hours do not divide. */
export function businessHourWindows(openMs: number, closeMs: number): Array<{ startMs: number; endMs: number }> {
  const out: Array<{ startMs: number; endMs: number }> = [];
  for (let start = openMs; start < closeMs; start += 3_600_000) {
    out.push({ startMs: start, endMs: Math.min(start + 3_600_000, closeMs) });
  }
  return out;
}

/**
 * How much of each business hour (and of the day so far) the camera spent WATCHING. Only
 * `WATCHING_STATE` counts; UNKNOWN is reported apart so an unanchored morning reads as "no
 * record", not as an outage and not as coverage.
 */
export function coverageByBusinessHour(
  segments: readonly TimelineSegment[],
  windows: ReadonlyArray<{ startMs: number; endMs: number }>,
  nowMs: number,
): BusinessCoverage {
  const hours: CoverageHour[] = windows.map((w) => {
    const end = Math.min(w.endMs, nowMs);
    const elapsedMs = Math.max(0, end - w.startMs);
    let watchedMs = 0;
    let unknownMs = 0;
    if (elapsedMs > 0) {
      for (const s of segments) {
        const a = Math.max(s.fromMs, w.startMs);
        const b = Math.min(s.toMs, end);
        if (b <= a) continue;
        if (s.state === WATCHING_STATE) watchedMs += b - a;
        else if (s.state === UNKNOWN_STATE) unknownMs += b - a;
      }
    }
    return { startMs: w.startMs, endMs: w.endMs, elapsedMs, watchedMs, unknownMs, pct: elapsedMs > 0 ? watchedMs / elapsedMs : null };
  });
  const elapsedMs = hours.reduce((n, h) => n + h.elapsedMs, 0);
  const watchedMs = hours.reduce((n, h) => n + h.watchedMs, 0);
  const unknownMs = hours.reduce((n, h) => n + h.unknownMs, 0);
  return { hours, elapsedMs, watchedMs, unknownMs, pct: elapsedMs > 0 ? watchedMs / elapsedMs : null };
}

/**
 * The row the 5-minute pass writes: the derived state differs from the last one recorded for
 * the camera. NEVER_INGESTED is not a transition (there is no row, so there is no camera to
 * time); a first derived state on an empty history anchors the timeline.
 */
export function derivedTransition(
  latestToState: string | null,
  verdict: { state: string; reason: string },
): { from: string | null; to: string; reason: string } | null {
  if (verdict.state === "NEVER_INGESTED") return null;
  if (latestToState === verdict.state) return null;
  const prefix = latestToState === null ? "first derived state" : "derived on the 5-minute pass";
  return { from: latestToState, to: verdict.state, reason: `${prefix}: ${verdict.reason}`.slice(0, 191) };
}

/**
 * The row the heartbeat ingest writes when a producer comes back after a READ-derived outage.
 * Its reported state did not change, so the ingest's own transition branch sees nothing; only
 * a gap longer than the stale threshold can mean the 5-minute pass logged something in between,
 * which is why the caller reads the last event only then.
 */
export function resumptionTransition(input: {
  gapSeconds: number | null;
  staleAfterSeconds: number;
  latestToState: string | null;
  state: string;
}): { from: string; to: string; reason: string } | null {
  const { gapSeconds, latestToState } = input;
  if (gapSeconds === null || !Number.isFinite(gapSeconds) || gapSeconds <= input.staleAfterSeconds) return null;
  if (latestToState === null || !READ_DERIVED_STATES.has(latestToState)) return null;
  const wording = latestToState.toLowerCase().replace(/_/g, " ");
  return {
    from: latestToState,
    to: input.state,
    reason: `producer resumed after ${wording} (${Math.round(gapSeconds)} s without a heartbeat)`.slice(0, 191),
  };
}
