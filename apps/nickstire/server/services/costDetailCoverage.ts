/**
 * Cost-detail coverage alarm.
 *
 * ─── Why this exists ───────────────────────────────────────────────────
 *
 * ShopDriver-sourced invoices carried parts/labor cost detail at ~100% through
 * 2026-03. Across April 2026 it collapsed - 33/56, then 9/31, then 1/33, then
 * 0/23 by week - and has been at 0% since May. Nothing noticed. The failure
 * surfaced four months later, in an audit, only because a margin of 76% looked
 * wrong next to a covered-basis margin of 7%.
 *
 * A single daily probe of "are today's invoices carrying cost detail?" would
 * have caught it the week of 2026-04-06. That is the whole of this module.
 *
 * ─── Design constraints, and why the obvious homes were rejected ───────
 *
 * · NOT in checkMirrorHealth. Measured 2026-08-25: alg-mirror-health skipped
 *   1,141 of its 1,274 runs on the SHOP-PROTECT `admin inactive` guard, because
 *   probing ALG evicts the shop's own ShopDriver login. A coverage check needs
 *   no ALG session - it is a plain query against invoices we already hold - so
 *   hosting it there would make the alarm as blind as the thing it watches.
 *
 * · NOT in nick-morning-brief. 6 of its last 8 runs skipped on a time-window
 *   guard.
 *
 * · The alert path is the `cron_alerts_fired` + Telegram idiom, chosen because
 *   it is DEMONSTRABLY live, not assumed: that table holds 69 rows across 4
 *   alert families over 88 days, most recently the same day this was written.
 *   `notification_messages`, the other candidate, holds ZERO rows - routing
 *   through it would have shipped into a void.
 *
 *   What that evidence proves and does not: it proves the alert code path
 *   executes and records. It does not prove Telegram delivered to a phone.
 *   That is the strongest evidence available without asking the operator.
 */

import { createLogger } from "../lib/logger";
import { MIN_COST_DETAIL_COVERAGE } from "./engines/revenue";

const log = createLogger("cost-detail-coverage");

/** Trailing window. A single day is too noisy - the shop books 2-6 invoices some days. */
export const COVERAGE_WINDOW_DAYS = 7;

/**
 * Below this many invoices in the window we report `insufficient-sample` and do
 * NOT alert. A quiet week is not a broken mirror, and an alarm that cries wolf
 * on low volume gets muted - at which point it guards nothing.
 */
export const MIN_SAMPLE_INVOICES = 5;

export type CoverageVerdict = "ok" | "below-threshold" | "insufficient-sample";

export interface CoverageReading {
  verdict: CoverageVerdict;
  invoices: number;
  withDetail: number;
  /** 0-100. Zero when there is no sample - read `verdict`, not this. */
  coveragePct: number;
  windowDays: number;
}

/**
 * PURE. Given counts, decide. Separated so the canary drives it with synthetic
 * numbers rather than whatever production holds today - a threshold test bound
 * to live data stops testing anything the moment the data changes.
 */
export function assessCoverage(invoices: number, withDetail: number): CoverageReading {
  const coveragePct = invoices > 0 ? Math.round((withDetail / invoices) * 100) : 0;
  const base = { invoices, withDetail, coveragePct, windowDays: COVERAGE_WINDOW_DAYS };

  if (invoices < MIN_SAMPLE_INVOICES) {
    return { ...base, verdict: "insufficient-sample" };
  }
  if (withDetail / invoices < MIN_COST_DETAIL_COVERAGE) {
    return { ...base, verdict: "below-threshold" };
  }
  return { ...base, verdict: "ok" };
}

/** The operator-facing sentence. Exported so the canary asserts the text, not a shape. */
export function coverageAlertMessage(reading: CoverageReading): string {
  return (
    `🔴 <b>COST DETAIL MISSING — margin cannot be computed</b>\n\n` +
    `Only <b>${reading.withDetail} of ${reading.invoices}</b> ShopDriver invoices in the last ` +
    `${reading.windowDays} days carry parts/labor cost (<b>${reading.coveragePct}%</b>, ` +
    `floor is ${Math.round(MIN_COST_DETAIL_COVERAGE * 100)}%).\n\n` +
    `Margin reporting is suppressed while this holds — the number would be arithmetic ` +
    `over empty fields, not a measurement.\n\n` +
    `This is a ShopDriver mirror problem, not a shop problem.`
  );
}

/**
 * Measure the trailing window and alert at most once per calendar day.
 *
 * Dedup is the `cron_alerts_fired` INSERT IGNORE claim used by vapiLatencySync:
 * atomic on (alert_key, fired_for), so N Railway pods send one copy, and a pod
 * restart cannot re-fire the same day.
 *
 * Never throws. The caller is a cron handler; a broken alarm must not take the
 * job down with it.
 */
export async function checkCostDetailCoverage(): Promise<{ reading: CoverageReading | null; alerted: boolean }> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { reading: null, alerted: false };

    const [rows] = await d.execute(sql`
      SELECT COUNT(*) AS invoices,
             SUM(CASE WHEN partsCost > 0 OR laborCost > 0 THEN 1 ELSE 0 END) AS withDetail
        FROM invoices
       WHERE source = 'shopdriver'
         AND invoiceDate >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(COVERAGE_WINDOW_DAYS))} DAY)
    `);
    const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
    const reading = assessCoverage(Number(row.invoices ?? 0), Number(row.withDetail ?? 0));

    if (reading.verdict !== "below-threshold") {
      return { reading, alerted: false };
    }

    // Claim today's slot. affectedRows === 1 means we won it.
    const [claim] = await d.execute(sql`
      INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for, fired_at, payload)
      VALUES ('cost_detail_coverage', CURDATE(), NOW(), ${JSON.stringify({
        invoices: reading.invoices,
        withDetail: reading.withDetail,
        coveragePct: reading.coveragePct,
      })})
    `);
    if (((claim as { affectedRows?: number })?.affectedRows ?? 0) !== 1) {
      return { reading, alerted: false };
    }

    const { sendTelegramMessage } = await import("./telegram");
    await sendTelegramMessage(coverageAlertMessage(reading));
    log.warn("cost-detail coverage below floor", {
      coveragePct: reading.coveragePct,
      invoices: reading.invoices,
      errorId: "COST_DETAIL_COVERAGE_LOW",
    });
    return { reading, alerted: true };
  } catch (err) {
    log.warn("cost-detail coverage check failed", { error: err instanceof Error ? err.message : String(err) });
    return { reading: null, alerted: false };
  }
}
