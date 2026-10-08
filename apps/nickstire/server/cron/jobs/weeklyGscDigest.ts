/**
 * Cron · Weekly GSC Digest (Mondays · business hours · exactly once)
 *
 * 2026-10-08 · the Search Console audit found that GSC numbers reach the
 * operator only by PULL: the admin Market card, `pnpm gsc:report`, and the
 * StateNour bridge. The one push, gsc-pipeline's daily "ranking drops" alert,
 * fires only on a 5-position loss — so a month of flat clicks, a CTR that never
 * recovered, or a query that quietly rose to page one is never seen. The weekly
 * revenue digest exists for exactly this reason on the money side
 * (weeklyRevenueDigest.ts: "a pull-only report on a phone-first operator is a
 * report that does not exist"). This is the search side of it.
 *
 * Two sources, kept distinct because they mean different things:
 *   · HEADLINE — the OFFICIAL no-dimension total from the Search Console API
 *     (getGscReport) for a closed 28-day window ending GSC_LAG_DAYS ago (GSC
 *     finalises data 2-3 days late; a window ending inside the lag reads low
 *     and would be reported as a drop), compared with the 28 days before it.
 *     Top queries and pages come from the same API call set.
 *   · INSIGHTS — CTR opportunities and 7-day ranking moves from the
 *     `search_performance` mirror that gsc-pipeline upserts daily
 *     (findCtrOpportunities / detectRankingChanges). The mirror can be empty or
 *     stale independently of the API, so the digest reads MAX(date) and SAYS
 *     which it is instead of rendering an empty list as "no opportunities".
 *
 * ~93% of query-dimension impressions are anonymised (gsc-data.ts header), so
 * the query lists describe the visible slice, never the population — no rate is
 * computed from them, and the message says so.
 *
 * Scheduling contract: HOURLY (2h) tier with `oncePerShopDay: true`, the
 * ROS-081 pattern the revenue digest uses — the 24h tier's phase can park
 * outside business hours forever; a 2h tier gets ~7 business-hour chances a day
 * and the per-job claim makes the first Monday tick the only one that runs.
 * The Monday gate is shop-TZ (ET), shared with the revenue digest.
 *
 * Failure posture: no official total → NOTHING is sent and the run REJECTS
 * (a zero-click digest off a lagging window is a lie, and a returned failure is
 * recorded `completed` in cron_log where the failure observer never sees it).
 * A failed Telegram send rejects. A schema error on the mirror query is
 * reported as SCHEMA BUG, loudly, per the #1125 distinction.
 */
import { createLogger } from "../../lib/logger";
import { isSchemaBugError } from "../../lib/dbErrors";
import { getBusinessDateKey } from "../../lib/timezoneAssert";
import { isShopMonday } from "./weeklyRevenueDigest";
import type { CtrOpportunity, DateRange, RankingChange } from "../../pipelines/gsc-data";

const log = createLogger("cron:weekly-gsc-digest");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

/** Closed window length. 28 days is the GSC UI's default comparison and long enough to dampen day-of-week noise. */
const GSC_WINDOW_DAYS = 28;
/** Days to leave off the end of the window for GSC's 2-3 day finalisation lag. */
const GSC_LAG_DAYS = 3;

const TOP_QUERIES = 8;
const TOP_PAGES = 5;
const MAX_OPPORTUNITIES = 5;
/** A (query, page) pair needs this many impressions in the window before its CTR is judged. */
const OPPORTUNITY_MIN_IMPRESSIONS = 50;
const MAX_MOVES = 4;
/** search_performance stores position × 100; 300 = 3 real positions, the module's own default. */
const MOVE_MIN_DELTA = 300;
const MOVE_MIN_POSITIONS = MOVE_MIN_DELTA / 100;

interface GscTotals {
  clicks: number;
  impressions: number;
  /** Fraction, as the API returns it (0.055 = 5.5%). */
  ctr: number;
  position: number;
}

interface GscRow extends GscTotals {
  key: string;
}

interface WeeklyGscDigestData {
  current: DateRange;
  prior: DateRange;
  totals: GscTotals;
  /** Null when Google returned no total row for the prior window — rendered as "no baseline", never as zeros. */
  priorTotals: GscTotals | null;
  topQueries: GscRow[];
  topPages: GscRow[];
  /** Newest `date` in the search_performance mirror (web rows); null when the mirror is empty. */
  mirrorThrough: string | null;
  ctrOpportunities: CtrOpportunity[];
  drops: RankingChange[];
  gains: RankingChange[];
}

/**
 * YYYY-MM-DD plus N days. Computed in UTC on the KEY so the shop-TZ day
 * boundary — taken exactly once, in getBusinessDateKey — is not re-applied.
 */
function shiftDateKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Two back-to-back closed windows of GSC_WINDOW_DAYS, the current one ending GSC_LAG_DAYS before the shop's today. */
function gscDigestWindows(now: Date = new Date()): { current: DateRange; prior: DateRange } {
  const endDate = shiftDateKey(getBusinessDateKey(now), -GSC_LAG_DAYS);
  const startDate = shiftDateKey(endDate, -(GSC_WINDOW_DAYS - 1));
  const priorEnd = shiftDateKey(startDate, -1);
  const priorStart = shiftDateKey(priorEnd, -(GSC_WINDOW_DAYS - 1));
  return {
    current: { startDate, endDate },
    prior: { startDate: priorStart, endDate: priorEnd },
  };
}

/** TiDB via drizzle mysql2 returns a tuple — [rows, fields] — from execute(). */
const tupleRows = (raw: unknown): unknown[] => {
  if (Array.isArray(raw) && Array.isArray(raw[0])) return raw[0] as unknown[];
  return Array.isArray(raw) ? raw : [];
};

async function computeWeeklyGscDigest(now: Date = new Date()): Promise<WeeklyGscDigestData> {
  const { getGscReport, findCtrOpportunities, detectRankingChanges } = await import(
    "../../pipelines/gsc-data"
  );
  const { current, prior } = gscDigestWindows(now);

  // Four Google calls: total + top queries + top pages for the current window,
  // total only for the prior one (its lists would be thrown away).
  const [cur, prev] = await Promise.all([
    getGscReport(current),
    getGscReport(prior, { totalsOnly: true }),
  ]);
  if (!cur.summaryHasData) {
    throw new Error(
      `GSC returned no official total for ${current.startDate}..${current.endDate} — nothing to report`,
    );
  }

  // The mirror's reach is read BEFORE its insights so an empty or stale table
  // is reported as such — an empty list from a table nobody has written to is
  // not "no opportunities".
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) throw new Error("No database");
  const throughRaw = await d.execute(sql`
    SELECT DATE_FORMAT(MAX(\`date\`), '%Y-%m-%d') AS throughDate
    FROM search_performance
    WHERE searchType = 'web'`);
  const through = tupleRows(throughRaw)[0] as Record<string, unknown> | undefined;
  const mirrorThrough = through?.throughDate ? String(through.throughDate).slice(0, 10) : null;

  let ctrOpportunities: CtrOpportunity[] = [];
  let drops: RankingChange[] = [];
  let gains: RankingChange[] = [];
  if (mirrorThrough !== null) {
    const [opportunities, moves] = await Promise.all([
      findCtrOpportunities({
        startDate: current.startDate,
        minImpressions: OPPORTUNITY_MIN_IMPRESSIONS,
        limit: MAX_OPPORTUNITIES,
      }),
      detectRankingChanges({ minDelta: MOVE_MIN_DELTA }),
    ]);
    ctrOpportunities = opportunities;
    drops = moves.filter((m) => m.direction === "dropped").slice(0, MAX_MOVES);
    gains = moves.filter((m) => m.direction === "improved").slice(0, MAX_MOVES);
  }

  return {
    current,
    prior,
    totals: cur.summary,
    priorTotals: prev.summaryHasData ? prev.summary : null,
    topQueries: cur.topQueries.slice(0, TOP_QUERIES),
    topPages: cur.topPages.slice(0, TOP_PAGES),
    mirrorThrough,
    ctrOpportunities,
    drops,
    gains,
  };
}

/** Telegram uses parse_mode HTML (telegram.ts sendRaw) — free-text queries must be escaped. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const num = (n: number): string => Math.round(n).toLocaleString("en-US");
const pct = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;
const pos = (p: number): string => p.toFixed(1);
const pathOf = (url: string): string => url.replace(/^https?:\/\/[^/]+/, "") || "/";
const arrow = (n: number): string => (n >= 0 ? "▲" : "▼");

/** Percent change vs prior. Null when prior is 0 — a delta against nothing is not a number. */
const deltaPct = (cur: number, prev: number): number | null =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

/** Date keys are rendered as calendar days — no timezone shift, the key IS the day. */
const fmtDay = (key: string): string =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });

function buildWeeklyGscDigestText(data: WeeklyGscDigestData): string {
  const t = data.totals;
  const lines: string[] = [
    `🔎 <b>WEEKLY SEARCH — ${num(t.clicks)} clicks</b>`,
    `${fmtDay(data.current.startDate)}–${fmtDay(data.current.endDate)} · ${GSC_WINDOW_DAYS} days, official GSC · ${num(t.impressions)} impressions · CTR ${pct(t.ctr)} · avg position ${pos(t.position)}`,
  ];

  const p = data.priorTotals;
  if (p === null) {
    lines.push(`no prior-period baseline — Google returned no total for the previous ${GSC_WINDOW_DAYS} days`);
  } else {
    const dc = deltaPct(t.clicks, p.clicks);
    const di = deltaPct(t.impressions, p.impressions);
    const clicksPart =
      dc === null
        ? `clicks vs prior ${GSC_WINDOW_DAYS}d: ${num(p.clicks)} → ${num(t.clicks)}`
        : `${arrow(dc)} ${Math.abs(dc)}% clicks vs prior ${GSC_WINDOW_DAYS}d (${num(p.clicks)})`;
    const imprPart =
      di === null
        ? `impressions ${num(p.impressions)} → ${num(t.impressions)}`
        : `impressions ${arrow(di)} ${Math.abs(di)}%`;
    lines.push(`${clicksPart} · ${imprPart} · position ${pos(p.position)} → ${pos(t.position)}`);
  }

  if (data.topQueries.length > 0) {
    lines.push(`Top queries (visible slice — most impressions are anonymised):`);
    data.topQueries.forEach((q, i) => {
      lines.push(
        `  ${i + 1}. ${esc(q.key)} — ${num(q.clicks)}c / ${num(q.impressions)}i · ${pct(q.ctr)} · #${pos(q.position)}`,
      );
    });
  }
  if (data.topPages.length > 0) {
    lines.push(`Top pages:`);
    data.topPages.forEach((pg, i) => {
      lines.push(
        `  ${i + 1}. ${esc(pathOf(pg.key))} — ${num(pg.clicks)}c / ${num(pg.impressions)}i · #${pos(pg.position)}`,
      );
    });
  }

  // Mirror-backed insights: say what the mirror holds BEFORE listing what it
  // found, so an empty section reads as a sync problem and not as good news.
  if (data.mirrorThrough === null) {
    lines.push(
      `⚠️ search_performance mirror is EMPTY — CTR opportunities and ranking moves unavailable (check gsc-pipeline)`,
    );
  } else {
    const behind = data.mirrorThrough < data.current.endDate;
    lines.push(
      behind
        ? `⚠️ mirror behind the window — synced through ${fmtDay(data.mirrorThrough)} only (check gsc-pipeline)`
        : `mirror synced through ${fmtDay(data.mirrorThrough)}`,
    );
    if (data.ctrOpportunities.length > 0) {
      lines.push(`CTR opportunities (impressions without the clicks the position should earn):`);
      data.ctrOpportunities.forEach((o) => {
        lines.push(
          `  • ${esc(o.query)} — #${pos(o.avgPosition)}, ${o.currentCtr.toFixed(1)}% CTR on ${num(o.impressions)}i → ${esc(pathOf(o.page))}`,
        );
      });
    } else {
      lines.push(`CTR opportunities: none above ${OPPORTUNITY_MIN_IMPRESSIONS} impressions`);
    }
    if (data.drops.length + data.gains.length > 0) {
      lines.push(`Ranking moves (last 7d vs prior 7d, ${MOVE_MIN_POSITIONS}+ positions):`);
      data.drops.forEach((m) => {
        lines.push(`  📉 ${esc(m.query)} #${pos(m.previousPosition)} → #${pos(m.currentPosition)}`);
      });
      data.gains.forEach((m) => {
        lines.push(`  📈 ${esc(m.query)} #${pos(m.previousPosition)} → #${pos(m.currentPosition)}`);
      });
    } else {
      lines.push(`Ranking moves: none of ${MOVE_MIN_POSITIONS}+ positions`);
    }
  }

  lines.push("— Nick's Tire & Auto");
  return lines.join("\n");
}

export async function runWeeklyGscDigest(now: Date = new Date()): Promise<ProcessResult> {
  if (!isShopMonday(now)) {
    return { recordsProcessed: 0, details: "skip · not Monday (shop TZ)" };
  }

  let data: WeeklyGscDigestData;
  try {
    data = await computeWeeklyGscDigest(now);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isSchemaBugError(e)) {
      log.error("weekly GSC digest hit a SCHEMA BUG — nothing sent", { error: msg });
      throw new Error(`SCHEMA BUG — ${msg}`, { cause: e });
    }
    log.warn("weekly GSC digest failed — nothing sent", { error: msg });
    throw new Error(`digest failed: ${msg}`, { cause: e });
  }

  const text = buildWeeklyGscDigestText(data);
  const { sendTelegram } = await import("../../services/telegram");
  const sent = await sendTelegram(text);
  if (!sent) {
    throw new Error("digest computed but Telegram send failed");
  }

  const clicksDelta = data.priorTotals ? deltaPct(data.totals.clicks, data.priorTotals.clicks) : null;
  const deltaLabel =
    clicksDelta === null ? "no baseline" : `${clicksDelta >= 0 ? "+" : ""}${clicksDelta}%`;
  log.info("weekly GSC digest sent", {
    window: `${data.current.startDate}..${data.current.endDate}`,
    clicks: data.totals.clicks,
    clicksDelta,
    ctrOpportunities: data.ctrOpportunities.length,
    drops: data.drops.length,
    mirrorThrough: data.mirrorThrough,
  });
  return {
    recordsProcessed: 1,
    details: `clicks ${num(data.totals.clicks)} (${deltaLabel}) · ${data.current.startDate}..${data.current.endDate} · ${data.ctrOpportunities.length} ctr opps · ${data.drops.length} drops · mirror ${data.mirrorThrough ?? "EMPTY"}`,
  };
}
