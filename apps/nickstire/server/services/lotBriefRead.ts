/**
 * The `lot_brief` bridge action's reads (camera audit 2026-10-07, N4). Every decision lives in
 * server/lib/lotBrief.ts; this file only turns rows into that module's input.
 *
 * Day boundaries come from `shopDayWindow` (America/New_York, DST-safe) and reach SQL as epoch
 * seconds, the convention lot.ts uses: the driver hands JS a DATETIME shifted by the ET offset, so
 * no time here is ever read as a JS Date. Arrivals are EPISODES (`COALESCE(episodeId, visitId)`),
 * PRODUCTION rows that were not already parked when watching began, drive-bys apart: the identity
 * the Lot page's headline counter uses, so the brief and the Lot can never disagree on a count.
 */
import { sql, type SQL } from "drizzle-orm";
import { BUSINESS } from "../../shared/business";
import { EXPECTED_CAMERAS } from "../../shared/cameras";
import { LOT_CONFIDENCE_RULES } from "../../shared/lotDataConfidence";
import { shopDayWindow } from "../../shared/shopState";
import type { HealthEventRow } from "../lib/cameraTimeline";
import { describeDbError, isMissingTableError } from "../lib/dbErrors";
import { readRows } from "../lib/dbResult";
import { createLogger } from "../lib/logger";
import {
  composeLotBrief,
  coverageForPastDay,
  longDwellAnomalies,
  LOT_BRIEF_RULES,
  TIMELINE_COMPLETE_FROM_MS,
  type DayCoverage,
  type DwellVisit,
  type LotBrief,
  type LongDwells,
} from "../lib/lotBrief";
import type { VisitMarkRow } from "../lib/visitMarks";

const log = createLogger("lot-brief");

type Db = { execute: (q: SQL) => Promise<unknown> };

export interface LotBriefFreshness {
  dataAsOf: string | null;
  ageMinutes: number | null;
  staleness: string;
}

export type LotBriefResult =
  | ({ ok: true; generatedAt: string; source: Record<string, string> } & LotBriefFreshness & LotBrief)
  | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** How far back an explicit `date` may reach: the baseline reads four weeks before it. */
const MAX_LOOKBACK_DAYS = 120;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** YYYY-MM-DD in the shop's zone. */
function shopDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
}

/** Calendar arithmetic on a YYYY-MM-DD, at UTC noon, so no zone or DST change can move it a day. */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The shop day a YYYY-MM-DD names. 12:00Z is 07:00 or 08:00 in New York, inside the same date. */
function windowOf(date: string) {
  const at = (d: string) => shopDayWindow(new Date(`${d}T12:00:00Z`), BUSINESS.timezone, BUSINESS.hours.structured);
  const w = at(date);
  return { ...w, date, dayEndMs: at(addDays(date, 1)).dayStartMs };
}

const eventRow = (e: Record<string, unknown>): HealthEventRow => ({
  toState: String(e.toState),
  fromState: str(e.fromState),
  reason: str(e.reason),
  atMs: num(e.atEpoch) * 1000,
});

export async function readLotBrief(
  d: Db,
  filters: Record<string, unknown>,
  opts: { freshness: LotBriefFreshness; nowMs?: number },
): Promise<LotBriefResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const today = shopDate(nowMs);
  const date = filters.date === undefined ? addDays(today, -1) : filters.date;
  if (
    typeof date !== "string" ||
    !DATE_RE.test(date) ||
    // A calendar date, not just its shape: 2026-02-30 matches the pattern and is no day.
    !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
    addDays(date, 0) !== date ||
    date >= today ||
    date < addDays(today, -MAX_LOOKBACK_DAYS)
  ) {
    return { ok: false, error: `date must be YYYY-MM-DD, before today and within ${MAX_LOOKBACK_DAYS} days` };
  }

  try {
    const target = windowOf(date);
    const priors = Array.from({ length: LOT_BRIEF_RULES.baselineWeeks }, (_, i) => windowOf(addDays(date, -7 * (i + 1))));
    const days = [target, ...priors];

    // 1 · Arrivals per day, one read for all five dates.
    const minStart = Math.floor(Math.min(...days.map((w) => w.dayStartMs)) / 1000);
    const maxEnd = Math.floor(Math.max(...days.map((w) => w.dayEndMs)) / 1000);
    const counts = new Map<string, { arrivals: number; passThroughs: number }>();
    for (const r of readRows(await d.execute(sql`
      SELECT ${sql.raw("DATE_FORMAT(CONVERT_TZ(arrivedAt, '+00:00', 'America/New_York'), '%Y-%m-%d')")} AS etDate,
        COUNT(DISTINCT CASE WHEN state <> 'PASS_THROUGH' THEN COALESCE(episodeId, visitId) END) AS arrivals,
        COUNT(DISTINCT CASE WHEN state =  'PASS_THROUGH' THEN COALESCE(episodeId, visitId) END) AS passThroughs
      FROM vehicle_visits
      WHERE dataClass = 'PRODUCTION'
        AND preexisting = 0
        AND arrivedAt IS NOT NULL
        AND UNIX_TIMESTAMP(arrivedAt) >= ${minStart}
        AND UNIX_TIMESTAMP(arrivedAt) < ${maxEnd}
      GROUP BY etDate
    `))) {
      counts.set(String(r.etDate), { arrivals: num(r.arrivals), passThroughs: num(r.passThroughs) });
    }
    const countOf = (day: string) => counts.get(day) ?? { arrivals: 0, passThroughs: 0 };

    // 2 · Coverage of each day the outage record covers, from the vehicle-truth camera's timeline.
    const truth = EXPECTED_CAMERAS.find((c) => c.role === "vehicle_truth") ?? null;
    const measurable = days.filter((w) => w.openMs !== null && w.openMs >= TIMELINE_COMPLETE_FROM_MS);
    let events: HealthEventRow[] = [];
    let before: HealthEventRow | null = null;
    if (truth && measurable.length) {
      const rangeStart = Math.floor(Math.min(...measurable.map((w) => w.dayStartMs)) / 1000);
      const rangeEnd = Math.floor(Math.max(...measurable.map((w) => w.dayEndMs)) / 1000);
      events = readRows(await d.execute(sql`
        SELECT fromState, toState, reason, UNIX_TIMESTAMP(at) AS atEpoch
        FROM camera_health_events
        WHERE camera = ${truth.camera} AND at >= FROM_UNIXTIME(${rangeStart}) AND at < FROM_UNIXTIME(${rangeEnd})
        ORDER BY at ASC, id ASC
      `)).map(eventRow);
      // The last row that CHANGED state before the range, as lot.health anchors its day.
      const [b] = readRows(await d.execute(sql`
        SELECT fromState, toState, reason, UNIX_TIMESTAMP(at) AS atEpoch
        FROM camera_health_events
        WHERE camera = ${truth.camera} AND at < FROM_UNIXTIME(${rangeStart})
          AND (fromState IS NULL OR fromState <> toState)
        ORDER BY at DESC, id DESC
        LIMIT 1
      `));
      before = b ? eventRow(b) : null;
    }
    const changed = (e: HealthEventRow) => e.fromState === null || e.fromState !== e.toState;
    const coverageOf = (w: ReturnType<typeof windowOf>): DayCoverage => {
      if (!truth) return { pctExpected: null, unmeasured: "no vehicle-truth camera is registered", segments: [] };
      const anchor = [...events].reverse().find((e) => e.atMs < w.dayStartMs && changed(e)) ?? before;
      return coverageForPastDay({
        anchor,
        events: events.filter((e) => e.atMs >= w.dayStartMs && e.atMs < w.dayEndMs),
        dayStartMs: w.dayStartMs,
        dayEndMs: w.dayEndMs,
        openMs: w.openMs,
        closeMs: w.closeMs,
      });
    };
    const targetCoverage = coverageOf(target);

    // 3 · Tickets dated that day, only when the invoice mirror synced after the day closed.
    const businessEndMs = target.closeMs ?? target.dayEndMs;
    const lastSyncMs = opts.freshness.dataAsOf ? Date.parse(opts.freshness.dataAsOf) : null;
    let tickets: { count: number | null; withheld: string | null };
    if (lastSyncMs === null || !Number.isFinite(lastSyncMs)) {
      tickets = { count: null, withheld: "the invoice mirror has not synced since the server started" };
    } else if (lastSyncMs < businessEndMs) {
      tickets = { count: null, withheld: "the invoice mirror last synced before the day closed" };
    } else {
      const [t] = readRows(await d.execute(sql`
        SELECT COUNT(*) AS n FROM invoices
        WHERE DATE(CONVERT_TZ(invoiceDate, '+00:00', 'America/New_York')) = ${date}
          AND paymentStatus <> 'refunded'
      `));
      tickets = { count: num(t?.n), withheld: null };
    }

    // 4 · Long stays nobody explains, judged only on a day the camera watched (the coverage gate).
    let longDwells: LongDwells | null = null;
    if (targetCoverage.pctExpected !== null && targetCoverage.pctExpected >= LOT_CONFIDENCE_RULES.minCoverage) {
      const endEpoch = Math.floor(businessEndMs / 1000);
      const visitRows = readRows(await d.execute(sql`
        SELECT visitId, COALESCE(episodeId, visitId) AS episodeKey,
               UNIX_TIMESTAMP(arrivedAt) AS arrivedEpoch, UNIX_TIMESTAMP(departedAt) AS departedEpoch,
               UNIX_TIMESTAMP(bayEnteredAt) AS bayEnteredEpoch, UNIX_TIMESTAMP(bayExitedAt) AS bayExitedEpoch
        FROM vehicle_visits
        WHERE dataClass = 'PRODUCTION'
          AND preexisting = 0
          AND state <> 'PASS_THROUGH'
          AND arrivedAt IS NOT NULL
          AND UNIX_TIMESTAMP(arrivedAt) >= ${Math.floor(target.dayStartMs / 1000)}
          AND UNIX_TIMESTAMP(arrivedAt) < ${Math.floor(target.dayEndMs / 1000)}
          AND LEAST(COALESCE(UNIX_TIMESTAMP(departedAt), ${endEpoch}), ${endEpoch}) - UNIX_TIMESTAMP(arrivedAt)
              >= ${LOT_BRIEF_RULES.longDwellMinutes * 60}
      `));
      const marksByVisit = new Map<string, VisitMarkRow[]>();
      if (visitRows.length) {
        try {
          const ids = visitRows.map((r) => sql`${String(r.visitId)}`);
          for (const m of readRows(await d.execute(sql`
            SELECT visitId, mark, UNIX_TIMESTAMP(markedAt) AS markedEpoch, note
            FROM vehicle_visit_marks
            WHERE visitId IN (${sql.join(ids, sql`, `)})
          `))) {
            const list = marksByVisit.get(String(m.visitId)) ?? [];
            list.push({ mark: String(m.mark), markedAtMs: num(m.markedEpoch) * 1000, note: str(m.note) });
            marksByVisit.set(String(m.visitId), list);
          }
        } catch (err) {
          // Before migration 0145 there are no marks to read: every long stay is then unexplained.
          if (!isMissingTableError(err)) throw err;
          log.warn("lot brief: vehicle_visit_marks missing; long stays read without marks");
        }
      }
      const visits: DwellVisit[] = visitRows.map((r) => {
        const departed = numOrNull(r.departedEpoch);
        const bayIn = numOrNull(r.bayEnteredEpoch);
        const bayOut = numOrNull(r.bayExitedEpoch);
        return {
          visitId: String(r.visitId),
          episodeKey: String(r.episodeKey),
          arrivedAtMs: num(r.arrivedEpoch) * 1000,
          departedAtMs: departed === null ? null : departed * 1000,
          bayEnteredAtMs: bayIn === null ? null : bayIn * 1000,
          bayExitedAtMs: bayOut === null ? null : bayOut * 1000,
          marks: marksByVisit.get(String(r.visitId)) ?? [],
        };
      });
      longDwells = longDwellAnomalies(visits, targetCoverage.segments, businessEndMs);
    }

    const brief = composeLotBrief({
      date,
      weekday: target.weekday,
      open: target.openMs !== null && target.closeMs !== null,
      ...countOf(date),
      coverage: { pctExpected: targetCoverage.pctExpected, unmeasured: targetCoverage.unmeasured },
      prior: priors.map((w) => ({ date: w.date, arrivals: countOf(w.date).arrivals, pctExpected: coverageOf(w).pctExpected })),
      tickets,
      longDwells,
    });
    return {
      ok: true,
      ...brief,
      generatedAt: new Date(nowMs).toISOString(),
      dataAsOf: opts.freshness.dataAsOf,
      ageMinutes: opts.freshness.ageMinutes,
      staleness: opts.freshness.staleness,
      source: {
        arrivals: "vehicle_visits: episodes, PRODUCTION, not pre-existing, drive-bys apart (the Lot page's counter)",
        coverage: "camera_health_events timeline of the vehicle-truth camera; complete from 2026-10-08 16:15Z",
        tickets: "invoices dated that day (ALG mirror; dataAsOf is the mirror's last sync)",
      },
    };
  } catch (err) {
    // A failed read is reported, never rendered as a quiet day.
    log.warn("lot brief read failed", { date, error: describeDbError(err) });
    return { ok: false, error: `lot brief read failed (${describeDbError(err)})` };
  }
}
