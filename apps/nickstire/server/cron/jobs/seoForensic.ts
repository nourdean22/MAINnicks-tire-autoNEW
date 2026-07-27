/**
 * Cron · SEO-Forensic (daily)
 *
 * Tier A · wave-181.x · catches SERP rank degradation early. The
 * search_performance table (GSC ingest) already has per-query
 * position data over time · this cron compares the trailing 7-day
 * average position per (query, page) pair against the prior 7-day
 * average and flags meaningful shifts.
 *
 * Why this matters · a page that quietly drops from rank 4 to rank
 * 18 loses 85% of its clicks but stays in the index. Without daily
 * monitoring this surfaces ONLY when revenue cliffs · weeks too
 * late. SEO drift is invisible until the impressions chart falls
 * off · this cron surfaces it the day after it happens.
 *
 * Scope · top 30 queries by impressions in the trailing 30 days ·
 * focuses attention on terms that actually drive traffic. Tracking
 * 500 long-tail queries would drown out the signal.
 *
 * Shift thresholds
 *   · drop >= 5 positions on a top-10-ranking page = warning
 *   · drop >= 10 positions on any page = alert
 *   · gain >= 5 positions = info (good news worth noting)
 *
 * Silent on stable runs · only fires Telegram when there's actual
 * movement to surface.
 */

import { createLogger } from "../../lib/logger";

const log = createLogger("cron:seo-forensic");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

interface RankShift {
  query: string;
  page: string;
  recentAvgPosition: number;
  priorAvgPosition: number;
  shift: number; // negative = improved, positive = worsened
  recentImpressions: number;
  severity: "alert" | "warning" | "info";
}

const RECENT_DAYS = 7;
const PRIOR_DAYS = 7;
const TOP_QUERIES_LIMIT = 30;
const WARNING_SHIFT = 5;
const ALERT_SHIFT = 10;

/**
 * `search_performance.position` is an INT holding position × 100 — GSC reports
 * fractional average positions and the column cannot store them. Verified in
 * prod: min 100 (= 1.0), avg 2197 (= 21.97), max 14600 (= 146.0).
 *
 * Every threshold in this file was written in REAL positions and compared
 * against RAW ones, which broke the classifier in both directions at once:
 *
 *   · `priorPos <= 10` (the top-10 gate on `warning`) needed a raw value of 10,
 *     i.e. real position 0.1 — impossible. Zero rows in the table satisfy it,
 *     while 11,326 rows ARE at real positions 1-10. The warning branch could
 *     never fire.
 *   · `shift >= ALERT_SHIFT` (10 raw) is a real drop of 0.1 positions, so the
 *     ALERT branch fired on ordinary daily noise.
 *   · the digest printed raw units — the operator was shown "position 3500"
 *     where the truth was 35.
 *
 * Converting once at read time fixes the gate, both thresholds, and the digest
 * together, because they all derive from these two numbers.
 */
const POSITION_SCALE = 100;

export async function processSeoForensic(): Promise<ProcessResult> {
  const start = Date.now();
  log.info("[seo-forensic] start");

  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  // 1 · top queries by recent impressions
  let topRows: Array<{ query: string; page: string; impressions: number }>;
  try {
    const r = await d.execute(sql`
      SELECT query, COALESCE(page, '') AS page, SUM(impressions) AS impressions
      FROM search_performance
      WHERE date >= DATE_SUB(NOW(), INTERVAL ${RECENT_DAYS + PRIOR_DAYS} DAY)
        AND query IS NOT NULL AND query <> ''
      GROUP BY query, page
      ORDER BY impressions DESC
      LIMIT ${TOP_QUERIES_LIMIT}
    `);
    topRows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as typeof topRows;
  } catch (e) {
    log.error("[seo-forensic] top-queries pull failed", { error: e instanceof Error ? e.message : String(e) });
    return { recordsProcessed: 0, details: "DB pull failed" };
  }

  if (!topRows || topRows.length === 0) {
    log.info("[seo-forensic] no top queries in window");
    return { recordsProcessed: 0, details: "no GSC data in window" };
  }

  // 2 · for each top query · pull recent vs prior avg position
  const shifts: RankShift[] = [];
  for (const row of topRows) {
    try {
      const positions = await d.execute(sql`
        SELECT
          AVG(CASE WHEN date >= DATE_SUB(NOW(), INTERVAL ${RECENT_DAYS} DAY) THEN position END) AS recent_pos,
          AVG(CASE WHEN date < DATE_SUB(NOW(), INTERVAL ${RECENT_DAYS} DAY) AND date >= DATE_SUB(NOW(), INTERVAL ${RECENT_DAYS + PRIOR_DAYS} DAY) THEN position END) AS prior_pos
        FROM search_performance
        WHERE query = ${row.query}
          AND COALESCE(page, '') = ${row.page}
          AND date >= DATE_SUB(NOW(), INTERVAL ${RECENT_DAYS + PRIOR_DAYS} DAY)
      `);
      const posRows = (Array.isArray(positions) && Array.isArray(positions[0]) ? positions[0] : positions) as Array<{ recent_pos: number | null; prior_pos: number | null }>;
      // Raw (×100) → real positions, ONCE, before anything compares them.
      const recentRaw = posRows[0]?.recent_pos;
      const priorRaw = posRows[0]?.prior_pos;
      if (!recentRaw || !priorRaw) continue;
      const recentPos = recentRaw / POSITION_SCALE;
      const priorPos = priorRaw / POSITION_SCALE;

      const shift = recentPos - priorPos; // positive = worsened (higher number = lower rank)
      const absShift = Math.abs(shift);
      if (absShift < WARNING_SHIFT) continue;

      let severity: RankShift["severity"];
      if (shift >= ALERT_SHIFT) severity = "alert";
      else if (shift >= WARNING_SHIFT && priorPos <= 10) severity = "warning";
      else if (shift <= -WARNING_SHIFT) severity = "info";
      else continue;

      shifts.push({
        query: row.query,
        page: row.page,
        recentAvgPosition: Math.round(recentPos * 10) / 10,
        priorAvgPosition: Math.round(priorPos * 10) / 10,
        shift: Math.round(shift * 10) / 10,
        recentImpressions: row.impressions,
        severity,
      });
    } catch (e) {
      log.warn("[seo-forensic] position pull failed for query", {
        query: row.query.slice(0, 40),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 3 · Telegram digest on meaningful shifts
  if (shifts.length > 0) {
    shifts.sort((a, b) => {
      const order = { alert: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });

    try {
      const { sendTelegram } = await import("../../services/telegram");
      const lines: string[] = [
        `🔎 SEO FORENSIC · ${shifts.length} rank shifts on top-${TOP_QUERIES_LIMIT} queries`,
        ``,
      ];
      for (const s of shifts.slice(0, 12)) {
        const emoji = s.severity === "alert" ? "🚨" : s.severity === "warning" ? "⚠" : "✅";
        const dir = s.shift > 0 ? "drop" : "gain";
        const page = s.page ? ` · ${s.page}` : "";
        lines.push(`${emoji} "${s.query.slice(0, 50)}"${page} · ${dir} ${Math.abs(s.shift)} pos (${s.priorAvgPosition} → ${s.recentAvgPosition}) · ${s.recentImpressions.toLocaleString()} impr`);
      }
      if (shifts.length > 12) {
        lines.push(``, `+ ${shifts.length - 12} more shifts · check search_performance table for full list`);
      }
      const alertCount = shifts.filter((s) => s.severity === "alert").length;
      if (alertCount > 0) {
        lines.push(``, `⚠ ${alertCount} alert-tier drops · investigate immediately · these queries previously drove traffic that's now bleeding`);
      }
      await sendTelegram(lines.join("\n"));
    } catch (e) {
      log.warn("[seo-forensic] telegram failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const durMs = Date.now() - start;
  log.info(`[seo-forensic] done in ${durMs}ms`, { topQueries: topRows.length, shifts: shifts.length });

  return {
    recordsProcessed: shifts.length,
    details: `top=${topRows.length} shifts=${shifts.length} alerts=${shifts.filter(s => s.severity === "alert").length}`,
  };
}
