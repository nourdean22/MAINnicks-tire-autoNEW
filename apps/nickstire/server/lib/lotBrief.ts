/**
 * server/lib/lotBrief.ts -- the lot camera's view of ONE shop day, for StateNour's morning brief
 * (camera audit 2026-10-07, N4: "three material events, traffic vs same-weekday baseline gated by
 * coverage, long-dwell anomalies, lot traffic with few tickets ... does not duplicate the Lot").
 *
 * Pure. The `lot_brief` bridge action (server/services/lotBriefRead.ts) reads the rows; this file
 * decides what is material and says it in at most three plain-text lines. Every comparison is read
 * against the share of business time the vehicle-truth camera actually watched (audit N2), with the
 * Lot page's own gate: below `LOT_CONFIDENCE_RULES.minCoverage` nothing is compared, and the
 * baseline needs `LOT_CONFIDENCE_RULES.minPriorDays` earlier days that passed the same gate.
 */
import { LOT_CONFIDENCE_RULES } from "../../shared/lotDataConfidence";
import {
  buildCameraTimeline,
  businessHourWindows,
  coverageByBusinessHour,
  type HealthEventRow,
  type TimelineSegment,
} from "./cameraTimeline";
import { deriveVisitMarkState, type VisitMarkRow } from "./visitMarks";

/**
 * `camera_health_events` is a complete record of the camera's state only from this instant: the
 * deployment of #2929 (Railway 3ce638b1, 2026-10-08 16:15:11Z) added the read-derived states
 * (STALE, PRODUCER_OFFLINE, EXPECTED_SOLAR_OFFLINE). Before it the table read HEALTHY straight
 * through every outage, so a day whose business hours opened earlier has no coverage measurement,
 * and a comparison against it would be a comparison with an unmeasured day.
 */
export const TIMELINE_COMPLETE_FROM_MS = Date.UTC(2026, 9, 8, 16, 15, 11);

export const LOT_BRIEF_RULES = {
  /** A car on the lot at least this long with no service recorded is a long-dwell anomaly. */
  longDwellMinutes: 180,
  /** ... unless the camera missed more than this much of its stay: its departure time is then uncertain. */
  maxUnwatchedDwellMinutes: 30,
  /** Traffic is unusual when it differs from the same-weekday mean by at least this many cars AND this share. */
  trafficMinCars: 3,
  trafficMinShare: 0.3,
  /**
   * "Lot traffic with few tickets": at least this many arrivals, and tickets under this share of
   * them. NOT calibrated against shop data yet: staff cars count as arrivals, so a quiet day reads
   * low. The line states both numbers so the owner judges the ratio, never a bare verdict.
   */
  fewTicketsMinArrivals: 8,
  fewTicketsMaxShare: 0.5,
  /** How many earlier same weekdays the baseline looks at. */
  baselineWeeks: 4,
  maxEvents: 3,
} as const;

const R = LOT_BRIEF_RULES;

/** How much of a past day's business time the camera watched; null when it was not measured. */
export interface DayCoverage {
  pctExpected: number | null;
  /** Why `pctExpected` is null, in words; null when measured. */
  unmeasured: string | null;
  /** The day's state segments (empty when not measured), for the per-car dwell check. */
  segments: TimelineSegment[];
}

/**
 * Coverage for a day that is OVER: the timeline runs to the end of the day and nothing is
 * reconciled with a live heartbeat (that is today's problem, `lot.health`'s). A day without
 * business hours, or one that opened before the record was complete, is unmeasured, not zero.
 */
export function coverageForPastDay(input: {
  anchor: HealthEventRow | null;
  events: readonly HealthEventRow[];
  dayStartMs: number;
  dayEndMs: number;
  openMs: number | null;
  closeMs: number | null;
}): DayCoverage {
  if (input.openMs === null || input.closeMs === null) {
    return { pctExpected: null, unmeasured: "the shop had no business hours", segments: [] };
  }
  if (input.openMs < TIMELINE_COMPLETE_FROM_MS) {
    return { pctExpected: null, unmeasured: "the camera's outage record starts 2026-10-08", segments: [] };
  }
  const tl = buildCameraTimeline({
    anchor: input.anchor,
    events: input.events,
    dayStartMs: input.dayStartMs,
    nowMs: input.dayEndMs,
  });
  const cov = coverageByBusinessHour(tl.segments, businessHourWindows(input.openMs, input.closeMs), input.dayEndMs);
  if (cov.pctExpected === null) {
    return { pctExpected: null, unmeasured: "every business minute was expected dark", segments: tl.segments };
  }
  return { pctExpected: cov.pctExpected, unmeasured: null, segments: tl.segments };
}

/** Minutes of [fromMs, toMs) the camera was NOT watching (any state but HEALTHY, solar dark included). */
export function unwatchedMinutes(segments: readonly TimelineSegment[], fromMs: number, toMs: number): number {
  let ms = 0;
  for (const s of segments) {
    if (s.state === "HEALTHY") continue;
    const a = Math.max(s.fromMs, fromMs);
    const b = Math.min(s.toMs, toMs);
    if (b > a) ms += b - a;
  }
  return Math.floor(ms / 60_000);
}

export interface DwellVisit {
  visitId: string;
  /** One car: a stitched re-arrival shares its episode with the first visit. */
  episodeKey: string;
  arrivedAtMs: number;
  departedAtMs: number | null;
  bayEnteredAtMs: number | null;
  bayExitedAtMs: number | null;
  marks: readonly VisitMarkRow[];
}

export interface LongDwells {
  /** Cars (episodes) that stayed `longDwellMinutes`+ of business time with no service recorded. */
  count: number;
  longestMinutes: number | null;
  /** Cars that stayed that long but whose stay the camera missed more than `maxUnwatchedDwellMinutes` of: not counted. */
  uncertain: number;
}

/**
 * Long stays nobody explains. A stay ends at departure or at close, whichever is first: a car
 * kept overnight for a multi-day job is measured by the business day it spent, not by the night.
 * A stay is explained, and not an anomaly, when the camera saw a bay or an operator marked service
 * (`deriveVisitMarkState`, the same derivation the Lot cards use); NOT_A_JOB removes the car.
 */
export function longDwellAnomalies(
  visits: readonly DwellVisit[],
  segments: readonly TimelineSegment[],
  businessEndMs: number,
): LongDwells {
  const longest = new Map<string, number>();
  const uncertain = new Set<string>();
  for (const v of visits) {
    const endMs = Math.min(v.departedAtMs ?? Number.POSITIVE_INFINITY, businessEndMs);
    const minutes = Math.floor((endMs - v.arrivedAtMs) / 60_000);
    if (!(minutes >= R.longDwellMinutes)) continue;
    const state = deriveVisitMarkState(
      { bayEnteredAtMs: v.bayEnteredAtMs, bayExitedAtMs: v.bayExitedAtMs, departedAtMs: v.departedAtMs },
      v.marks,
      endMs,
    );
    if (state.notAJob) continue;
    if (state.serviceStartedAtMs !== null || state.serviceDoneAtMs !== null) continue;
    if (unwatchedMinutes(segments, v.arrivedAtMs, endMs) > R.maxUnwatchedDwellMinutes) {
      uncertain.add(v.episodeKey);
      continue;
    }
    longest.set(v.episodeKey, Math.max(longest.get(v.episodeKey) ?? 0, minutes));
  }
  for (const key of longest.keys()) uncertain.delete(key);
  const values = [...longest.values()];
  return {
    count: values.length,
    longestMinutes: values.length ? Math.max(...values) : null,
    uncertain: uncertain.size,
  };
}

export interface LotBriefInput {
  /** The shop-local date, YYYY-MM-DD. */
  date: string;
  /** Lower-case weekday name, as `shopDayWindow` returns it. */
  weekday: string;
  /** False when the shop had no business hours that day. */
  open: boolean;
  /** Episodes that arrived (PRODUCTION, not pre-existing, not PASS_THROUGH) and drive-bys apart. */
  arrivals: number;
  passThroughs: number;
  coverage: { pctExpected: number | null; unmeasured: string | null };
  /** The same weekday in each earlier week, newest first. */
  prior: ReadonlyArray<{ date: string; arrivals: number; pctExpected: number | null }>;
  /** Tickets dated that day; null with the reason when the invoice mirror cannot vouch for the whole day. */
  tickets: { count: number | null; withheld: string | null };
  /** Null when the day's coverage did not pass the gate: dwell times are not judged on an unwatched day. */
  longDwells: LongDwells | null;
}

export type LotBriefEventKind = "coverage_low" | "traffic_high" | "traffic_low" | "few_tickets" | "long_dwells";

export interface LotBriefEvent {
  kind: LotBriefEventKind;
  text: string;
}

export interface LotBrief {
  date: string;
  weekday: string;
  open: boolean;
  arrivals: number;
  passThroughs: number;
  coverage: { pctExpected: number | null; gatePassed: boolean; unmeasured: string | null };
  baseline: { weeksConsidered: number; weeksCompared: number; meanArrivals: number | null; withheld: string | null };
  tickets: { count: number | null; withheld: string | null };
  longDwells: LongDwells | null;
  /** At most `maxEvents`, most material first: trust in the counts, then traffic, tickets, dwell. */
  events: LotBriefEvent[];
  /** What the brief renders: the events' text, or one summary line when nothing is material. */
  lines: string[];
}

const title = (weekday: string): string => (weekday ? weekday[0].toUpperCase() + weekday.slice(1) : weekday);
const cars = (n: number): string => `${n} car${n === 1 ? "" : "s"}`;
const pct = (share: number): string => `${Math.floor(share * 100)}%`;
const duration = (minutes: number): string => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

export function composeLotBrief(input: LotBriefInput): LotBrief {
  const day = title(input.weekday);
  const minCoverage = LOT_CONFIDENCE_RULES.minCoverage;
  const gatePassed = input.coverage.pctExpected !== null && input.coverage.pctExpected >= minCoverage;
  const events: LotBriefEvent[] = [];

  if (input.open && input.coverage.pctExpected !== null && !gatePassed) {
    events.push({
      kind: "coverage_low",
      text: `The lot camera watched ${pct(input.coverage.pctExpected)} of ${day}'s business hours, so its count of ${cars(input.arrivals)} is a floor and nothing was compared.`,
    });
  }

  // Same-weekday baseline: only earlier days that passed the same coverage gate.
  const prior = input.prior.slice(0, R.baselineWeeks);
  const compared = prior.filter((p) => p.pctExpected !== null && p.pctExpected >= minCoverage);
  let meanArrivals: number | null = null;
  let withheld: string | null = null;
  if (!input.open) withheld = "the shop was closed";
  else if (!gatePassed) {
    withheld = input.coverage.pctExpected === null
      ? `coverage not measured (${input.coverage.unmeasured ?? "no record"})`
      : `the camera watched under ${pct(minCoverage)} of the day`;
  } else if (compared.length < LOT_CONFIDENCE_RULES.minPriorDays) {
    withheld = `${compared.length} of the last ${prior.length} ${day}s ${compared.length === 1 ? "was" : "were"} watched enough to compare`;
  } else {
    meanArrivals = compared.reduce((n, p) => n + p.arrivals, 0) / compared.length;
    const delta = input.arrivals - meanArrivals;
    if (Math.abs(delta) >= Math.max(R.trafficMinCars, R.trafficMinShare * meanArrivals)) {
      const usual = `about ${Math.round(meanArrivals)} on the last ${compared.length} ${day}s`;
      events.push(delta > 0
        ? { kind: "traffic_high", text: `Busier than usual: ${cars(input.arrivals)} came in ${day}, against ${usual}.` }
        : { kind: "traffic_low", text: `Quieter than usual: ${cars(input.arrivals)} came in ${day}, against ${usual}.` });
    }
  }

  // An undercount (a camera gap) can only hide this one, never invent it, so it is not gated on coverage.
  if (
    input.open &&
    input.tickets.count !== null &&
    input.arrivals >= R.fewTicketsMinArrivals &&
    input.tickets.count < input.arrivals * R.fewTicketsMaxShare
  ) {
    events.push({
      kind: "few_tickets",
      text: `Lot traffic with few tickets: ${cars(input.arrivals)} came in ${day} and ${input.tickets.count} ticket${input.tickets.count === 1 ? " is" : "s are"} dated ${day}.`,
    });
  }

  if (input.open && gatePassed && input.longDwells && input.longDwells.count > 0 && input.longDwells.longestMinutes !== null) {
    events.push({
      kind: "long_dwells",
      text: `${cars(input.longDwells.count)} stayed ${R.longDwellMinutes / 60}h+ ${day} with no service recorded (longest ${duration(input.longDwells.longestMinutes)}).`,
    });
  }

  const top = events.slice(0, R.maxEvents);
  let summary: string;
  if (!input.open) {
    summary = `${day}: the shop was closed; the lot camera recorded ${cars(input.arrivals)} coming in.`;
  } else if (input.coverage.pctExpected === null) {
    summary = `${day}: ${cars(input.arrivals)} came in; coverage not measured (${input.coverage.unmeasured ?? "no record"}), so nothing was compared.`;
  } else if (meanArrivals !== null) {
    summary = `${day}: ${cars(input.arrivals)} came in, in line with recent ${day}s (camera watched ${pct(input.coverage.pctExpected)} of business hours).`;
  } else {
    summary = `${day}: ${cars(input.arrivals)} came in (camera watched ${pct(input.coverage.pctExpected)} of business hours); no same-weekday comparison yet, ${withheld}.`;
  }

  return {
    date: input.date,
    weekday: input.weekday,
    open: input.open,
    arrivals: input.arrivals,
    passThroughs: input.passThroughs,
    coverage: { pctExpected: input.coverage.pctExpected, gatePassed, unmeasured: input.coverage.unmeasured },
    baseline: { weeksConsidered: prior.length, weeksCompared: compared.length, meanArrivals, withheld },
    tickets: input.tickets,
    longDwells: input.longDwells,
    events: top,
    lines: top.length ? top.map((e) => e.text) : [summary],
  };
}
