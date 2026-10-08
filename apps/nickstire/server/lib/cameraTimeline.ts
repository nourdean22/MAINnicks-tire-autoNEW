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

import { HEALTH_THRESHOLDS } from "./cameraHealth";

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
  // A row stamped a moment AFTER the reader's clock (the database clock a second ahead of the
  // app's) is still the latest fact about the camera; it is clamped to now, never dropped.
  const events = input.events
    .filter((e) => e.atMs >= dayStartMs)
    .map((e) => (e.atMs > nowMs ? { ...e, atMs: nowMs } : e))
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
  /**
   * Elapsed time the camera was EXPECTED dark (EXPECTED_SOLAR_OFFLINE, audit N3): not watched,
   * but not a data-quality gap either -- the baseline days were dark at the same hours, so this
   * time is excluded from `pctExpected` and from the per-hour scaling of the baseline.
   */
  solarMs: number;
  /** watched / elapsed, or null while nothing of the hour has passed. The honest share for the chip. */
  pct: number | null;
  /** watched / (elapsed - solar): the share of the time the camera was expected to watch; null when nothing was expected. */
  pctExpected: number | null;
}

export interface BusinessCoverage {
  hours: CoverageHour[];
  elapsedMs: number;
  watchedMs: number;
  unknownMs: number;
  solarMs: number;
  /** watched / elapsed over the whole business day so far, or null before it opens. */
  pct: number | null;
  /** watched / (elapsed - solar) over the day so far; null before it opens or while every minute was expected dark. */
  pctExpected: number | null;
}

/** The state the lot is expected NOT to be watched in: a solar camera dark on its battery. */
const EXPECTED_DARK_STATE = "EXPECTED_SOLAR_OFFLINE";

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
  const share = (watched: number, denominator: number): number | null => (denominator > 0 ? watched / denominator : null);
  const hours: CoverageHour[] = windows.map((w) => {
    const end = Math.min(w.endMs, nowMs);
    const elapsedMs = Math.max(0, end - w.startMs);
    let watchedMs = 0;
    let unknownMs = 0;
    let solarMs = 0;
    if (elapsedMs > 0) {
      for (const s of segments) {
        const a = Math.max(s.fromMs, w.startMs);
        const b = Math.min(s.toMs, end);
        if (b <= a) continue;
        if (s.state === WATCHING_STATE) watchedMs += b - a;
        else if (s.state === UNKNOWN_STATE) unknownMs += b - a;
        else if (s.state === EXPECTED_DARK_STATE) solarMs += b - a;
      }
    }
    return {
      startMs: w.startMs,
      endMs: w.endMs,
      elapsedMs,
      watchedMs,
      unknownMs,
      solarMs,
      pct: share(watchedMs, elapsedMs),
      pctExpected: share(watchedMs, elapsedMs - solarMs),
    };
  });
  const elapsedMs = hours.reduce((n, h) => n + h.elapsedMs, 0);
  const watchedMs = hours.reduce((n, h) => n + h.watchedMs, 0);
  const unknownMs = hours.reduce((n, h) => n + h.unknownMs, 0);
  const solarMs = hours.reduce((n, h) => n + h.solarMs, 0);
  return {
    hours,
    elapsedMs,
    watchedMs,
    unknownMs,
    solarMs,
    pct: share(watchedMs, elapsedMs),
    pctExpected: share(watchedMs, elapsedMs - solarMs),
  };
}

/**
 * When a derived state BEGAN, on the heartbeat clock, not on the clock of whoever noticed it
 * (review on #2929): the 5-minute pass sees a dead producer up to five minutes late, and a
 * timeline row stamped at the tick counted those minutes as watched. STALE begins
 * `staleAfterSeconds` after the last heartbeat, PRODUCER_OFFLINE `offlineAfterSeconds` after
 * it; an expected solar outage that is a heartbeat gap begins like STALE, one that the producer
 * itself reports begins at its `stateSince`; every other state at `stateSince`. Never later
 * than `nowMs`, and null when no clock identifies it (no row at all).
 */
export function derivedStateBeganAtMs(input: {
  state: string;
  receivedAtEpoch: number | null;
  ageSeconds: number | null;
  stateSinceEpoch: number | null;
  nowMs: number;
}): number | null {
  const T = HEALTH_THRESHOLDS;
  const fromHeartbeat = (lagSeconds: number): number | null =>
    input.receivedAtEpoch === null ? null : (input.receivedAtEpoch + lagSeconds) * 1000;
  let began: number | null;
  if (input.state === "STALE") began = fromHeartbeat(T.staleAfterSeconds);
  else if (input.state === "PRODUCER_OFFLINE") began = fromHeartbeat(T.offlineAfterSeconds);
  else if (input.state === "EXPECTED_SOLAR_OFFLINE") {
    const gap = input.ageSeconds !== null && input.ageSeconds > T.staleAfterSeconds;
    began = gap ? fromHeartbeat(T.staleAfterSeconds) : input.stateSinceEpoch === null ? null : input.stateSinceEpoch * 1000;
  } else began = input.stateSinceEpoch === null ? null : input.stateSinceEpoch * 1000;
  return began === null ? null : Math.min(began, input.nowMs);
}

/**
 * The recorded day, corrected by what the reader can see RIGHT NOW. The rows lag: the pass
 * writes a read-derived state up to five minutes after it began, and a camera the pass does not
 * cover never gets one. The reader derives the live state itself, so when it differs from the
 * state the rows left open, the open segment is cut where the live state began and the live
 * state takes over to now. Pure; the rows are not touched.
 */
export function reconcileWithLive(
  timeline: CameraTimeline,
  live: { state: string; sinceMs: number | null; reason: string | null },
  nowMs: number,
): CameraTimeline {
  if (live.state === "NEVER_INGESTED") return timeline;
  const current = timeline.current;
  if (current !== null && current.state === live.state) return timeline;
  const segments = timeline.segments.slice();
  const open = segments.pop();
  if (!open) return timeline;
  // The live state began at `sinceMs`, but not before the open segment started (the rows know
  // nothing earlier than that) and not after now.
  const cut = Math.max(open.fromMs, Math.min(live.sinceMs ?? nowMs, nowMs));
  if (cut > open.fromMs) segments.push({ ...open, toMs: cut, open: false });
  segments.push({ state: live.state, fromMs: cut, toMs: Math.max(nowMs, cut), open: true, reason: live.reason });
  const sinceMs = live.sinceMs ?? cut;
  return {
    anchorKnown: timeline.anchorKnown,
    segments,
    current: { state: live.state, sinceMs, forSeconds: Math.max(0, Math.round((nowMs - sinceMs) / 1000)) },
  };
}

/**
 * The outage row the heartbeat ingest writes for a gap the 5-minute pass never recorded (the
 * gap fell between two ticks): STALE or PRODUCER_OFFLINE by its length, stamped where it began
 * on the heartbeat clock, or EXPECTED_SOLAR_OFFLINE when a solar camera went dark inside its
 * window. Without it a short outage was invisible and its minutes counted as watched (review on
 * #2929). Null when the last recorded state already is a read-derived outage (the pass saw it),
 * or when the gap is within the stale threshold.
 */
export function retroOutageTransition(input: {
  gapSeconds: number | null;
  prevReceivedEpoch: number | null;
  latestToState: string | null;
  solarExpectedAt?: ((ms: number) => boolean) | null;
}): { from: string | null; to: string; reason: string; atEpoch: number } | null {
  const { gapSeconds, prevReceivedEpoch, latestToState } = input;
  const T = HEALTH_THRESHOLDS;
  if (gapSeconds === null || !Number.isFinite(gapSeconds) || gapSeconds <= T.staleAfterSeconds) return null;
  if (prevReceivedEpoch === null) return null;
  if (latestToState !== null && READ_DERIVED_STATES.has(latestToState)) return null;
  const offline = gapSeconds > T.offlineAfterSeconds;
  const atEpoch = prevReceivedEpoch + (offline ? T.offlineAfterSeconds : T.staleAfterSeconds);
  const solar = input.solarExpectedAt ? input.solarExpectedAt(atEpoch * 1000) : false;
  const to = solar ? "EXPECTED_SOLAR_OFFLINE" : offline ? "PRODUCER_OFFLINE" : "STALE";
  const reason = solar
    ? `dark inside the solar window: no heartbeat for ${Math.round(gapSeconds)} s (recorded at resumption)`
    : `no heartbeat for ${Math.round(gapSeconds)} s (recorded at resumption; began ${offline ? T.offlineAfterSeconds : T.staleAfterSeconds} s after the last one)`;
  return { from: latestToState, to, reason: reason.slice(0, 191), atEpoch };
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
