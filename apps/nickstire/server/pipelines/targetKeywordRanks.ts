/**
 * Where the site stands in Google search for each tracked keyword, from the shop's own
 * stored Search Console rows (contract localGrowth.targetKeywordRanks v1, 2026-10-25).
 *
 * Read-only. Two 28-day windows ending at the newest stored date (the table lags Google by
 * 2-3 days by design), impression-weighted position across pages, devices and countries, and
 * one action per keyword. A keyword with no recorded impression has NO position: Google only
 * records a position with an impression, and about 93% of query impressions are anonymised
 * (gsc-data.ts header), so "no recorded impressions" never means "not ranking" and a keyword
 * figure is a visible slice; `totals` is the denominator the card shows beside it.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { searchPerformance } from "../../drizzle/schema";
import { dbTyped } from "../lib/db-helper";
import { logSafeErrorMessage } from "../lib/dbErrors";
import { getBusinessDateKey, shiftDateKey } from "../lib/timezoneAssert";
import { RANK_KEYWORDS, type RankKeyword } from "@shared/localRankKeywords";

// Proposed rulings (Perplexity benchmark 2026-10-25), adopted here; not vendor standards.
const WINDOW_DAYS = 28;
const CONTEXT_DAYS = 90;
const MIN_IMPRESSIONS = 30; // floor for claiming a change, and for the snippet rule
const DECLINE_POSITIONS = 2.0;
const PAGE_ONE_POSITION = 10;
const STALE_DAYS = 7;

type KeywordWindow = { impressions: number; clicks: number; position: number };
type KeywordAction =
  | "check_sync" | "review_variants" | "verify_local" | "compare_top_results" | "review_snippet" | "new" | "monitor";
type KeywordRank = {
  keyword: string;
  group: RankKeyword["group"];
  current: KeywordWindow | null;
  previous: KeywordWindow | null;
  seenIn90Days: boolean;
  change: number | null;
  action: KeywordAction;
};
type TargetKeywordRanksResult =
  | {
      ok: true;
      latestDate: string;
      staleDays: number;
      window: { current: { from: string; to: string }; previous: { from: string; to: string } };
      keywords: KeywordRank[];
      totals: { impressions28d: number; distinctQueries28d: number };
    }
  | { ok: false; reason: "unconfigured" | "unmeasured" | "error"; message: string };

const sp = searchPerformance;
const lowerQuery = sql<string>`LOWER(${sp.query})`;

function actionFor(k: Omit<KeywordRank, "action">, staleDays: number): KeywordAction {
  if (staleDays > STALE_DAYS) return "check_sync";
  if (!k.current && !k.previous && !k.seenIn90Days) return "verify_local";
  if (!k.current) return "review_variants";
  if (!k.previous) return "new";
  if (k.change !== null && k.change <= -DECLINE_POSITIONS) return "compare_top_results";
  if (k.current.impressions >= MIN_IMPRESSIONS && k.current.position <= PAGE_ONE_POSITION && k.current.clicks === 0) {
    return "review_snippet";
  }
  return "monitor";
}

export async function getTargetKeywordRanks(now: Date = new Date()): Promise<TargetKeywordRanksResult> {
  const d = await dbTyped();
  if (!d) return { ok: false, reason: "error", message: "Database unavailable: Search Console rows could not be read." };
  const keys = [...new Set(RANK_KEYWORDS.map((k) => k.keyword.toLowerCase()))];
  const web = eq(sp.searchType, "web");

  try {
    const [latest] = await d.select({ latestDate: sql<string | null>`MAX(${sp.date})` }).from(sp).where(web);
    const latestDate = latest?.latestDate ?? null;
    if (!latestDate) {
      return process.env.GOOGLE_SEARCH_CONSOLE_KEY
        ? { ok: false, reason: "unmeasured", message: "No Search Console rows stored yet: the daily gsc-pipeline sync has not written any." }
        : { ok: false, reason: "unconfigured", message: "Search Console is not connected and no rows are stored." };
    }

    const current = { from: shiftDateKey(latestDate, -(WINDOW_DAYS - 1)), to: latestDate };
    const previous = { from: shiftDateKey(latestDate, -(2 * WINDOW_DAYS - 1)), to: shiftDateKey(latestDate, -WINDOW_DAYS) };
    const contextFrom = shiftDateKey(latestDate, -(CONTEXT_DAYS - 1));
    const inRange = (from: string, to: string) => and(web, gte(sp.date, from), lte(sp.date, to));

    const readWindow = (w: { from: string; to: string }) =>
      d
        .select({
          q: lowerQuery,
          impressions: sql<string>`SUM(${sp.impressions})`,
          clicks: sql<string>`SUM(${sp.clicks})`,
          positionX100: sql<string | null>`SUM(${sp.position} * ${sp.impressions}) / NULLIF(SUM(${sp.impressions}), 0)`,
        })
        .from(sp)
        .where(and(inRange(w.from, w.to), inArray(lowerQuery, keys)))
        .groupBy(sql`1`); // ONLY_FULL_GROUP_BY: an ordinal names the select item exactly

    const [curRows, prevRows, seenRows, totalRows] = await Promise.all([
      readWindow(current),
      readWindow(previous),
      d.select({ q: lowerQuery }).from(sp).where(and(inRange(contextFrom, latestDate), inArray(lowerQuery, keys))).groupBy(sql`1`),
      d
        .select({ impressions: sql<string | null>`SUM(${sp.impressions})`, queries: sql<number>`COUNT(DISTINCT LOWER(${sp.query}))` })
        .from(sp)
        .where(inRange(current.from, current.to)),
    ]);

    // Stored position is x100; divided once here. A window with no impression has no position.
    const toMap = (rows: typeof curRows) => {
      const m = new Map<string, KeywordWindow>();
      for (const r of rows) {
        const impressions = Number(r.impressions);
        if (!(impressions > 0) || r.positionX100 === null) continue;
        m.set(String(r.q), { impressions, clicks: Number(r.clicks), position: Math.round(Number(r.positionX100) / 10) / 10 });
      }
      return m;
    };
    const cur = toMap(curRows);
    const prev = toMap(prevRows);
    const seen = new Set(seenRows.map((r) => String(r.q)));
    const staleDays = Math.round((Date.parse(getBusinessDateKey(now)) - Date.parse(latestDate)) / 86_400_000);

    const keywords = RANK_KEYWORDS.map((k): KeywordRank => {
      const key = k.keyword.toLowerCase();
      const c = cur.get(key) ?? null;
      const p = prev.get(key) ?? null;
      const change =
        c && p && c.impressions >= MIN_IMPRESSIONS && p.impressions >= MIN_IMPRESSIONS
          ? Math.round((p.position - c.position) * 10) / 10
          : null;
      const base = { keyword: k.keyword, group: k.group, current: c, previous: p, seenIn90Days: seen.has(key), change };
      return { ...base, action: actionFor(base, staleDays) };
    });

    return {
      ok: true,
      latestDate,
      staleDays,
      window: { current, previous },
      keywords,
      totals: { impressions28d: Number(totalRows[0]?.impressions ?? 0), distinctQueries28d: Number(totalRows[0]?.queries ?? 0) },
    };
  } catch (err) {
    return { ok: false, reason: "error", message: `Search Console rows could not be read: ${logSafeErrorMessage(err)}` };
  }
}
