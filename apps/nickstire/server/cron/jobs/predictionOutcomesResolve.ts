/**
 * Cron · Prediction Outcomes Resolver (daily) · 2026-07-07
 *
 * The missing WRITER for the service-affinity closed loop. The 2026-05-24
 * v2 design (docs/2026-05-24-service-affinity-v2.md §2.3) shipped the
 * `prediction_outcomes` table (migration 0061) and its READER — the
 * closedLoop resolver `service_affinity_acted_to_revenue_14d` LEFT JOINs
 * it — but no job ever inserted rows, so the resolver has returned 0
 * since launch and the 50/50 `ab_arm` experiment has run with no readout.
 *
 * Resolution semantics (two idempotent passes, NOT EXISTS guarded):
 *   1 · EARLY MATCH — any unresolved prediction whose customer has an
 *       invoice inside [created_at, created_at + 14d) resolves matched=1
 *       immediately (no need to wait out the window once conversion is
 *       observed).
 *   2 · WINDOW CLOSED — unresolved predictions older than 14d resolve
 *       matched=0 (the window elapsed with no invoice).
 *
 * Phone join: predictions carry customer_id only; invoices carry a
 * free-form customerPhone. Join on last-10-digits, the same
 * normalization every existing attribution loop uses
 * (smsInstrumentation.ts:34-37). Function-wrapped join columns skip
 * indexes, which is acceptable for a daily batch capped at
 * RESOLVE_BATCH_LIMIT rows against single-shop invoice volume.
 *
 * The 60-day scan floor bounds the first backfill run (the predictions
 * table only started filling after migration 0061, ~2026-05-24).
 */

import { createLogger } from "../../lib/logger";

const log = createLogger("cron:prediction-outcomes");

const WINDOW_DAYS = 14;
const SCAN_FLOOR_DAYS = 60;
const RESOLVE_BATCH_LIMIT = 2000;

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

export async function processPredictionOutcomesResolve(): Promise<ProcessResult> {
  const start = Date.now();
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) {
    return { recordsProcessed: 0, details: "db unavailable" };
  }

  // Pass 1 · early matches. MIN(i.id) keeps one outcome row per
  // prediction when several invoices land in the window.
  const [matchRes] = await d.execute(sql`
    INSERT INTO prediction_outcomes (prediction_id, invoice_id, matched, window_days)
    SELECT sap.id, MIN(i.id), 1, ${WINDOW_DAYS}
    FROM service_affinity_predictions sap
    JOIN customers c ON c.id = sap.customer_id
    JOIN invoices i
      ON RIGHT(REGEXP_REPLACE(i.customerPhone, '[^0-9]', ''), 10)
       = RIGHT(REGEXP_REPLACE(c.phone, '[^0-9]', ''), 10)
     AND i.invoiceDate >= sap.created_at
     AND i.invoiceDate < DATE_ADD(sap.created_at, INTERVAL ${WINDOW_DAYS} DAY)
    WHERE sap.created_at >= DATE_SUB(NOW(), INTERVAL ${SCAN_FLOOR_DAYS} DAY)
      AND NOT EXISTS (
        SELECT 1 FROM prediction_outcomes po WHERE po.prediction_id = sap.id
      )
    GROUP BY sap.id
    LIMIT ${RESOLVE_BATCH_LIMIT}
  `);
  const matchedInserted =
    (matchRes as unknown as { affectedRows?: number }).affectedRows ?? 0;

  // Pass 2 · closed windows with no invoice. Runs AFTER pass 1 so a
  // matured prediction with a real match was already claimed matched=1.
  const [missRes] = await d.execute(sql`
    INSERT INTO prediction_outcomes (prediction_id, invoice_id, matched, window_days)
    SELECT sap.id, NULL, 0, ${WINDOW_DAYS}
    FROM service_affinity_predictions sap
    WHERE sap.created_at >= DATE_SUB(NOW(), INTERVAL ${SCAN_FLOOR_DAYS} DAY)
      AND sap.created_at < DATE_SUB(NOW(), INTERVAL ${WINDOW_DAYS} DAY)
      AND NOT EXISTS (
        SELECT 1 FROM prediction_outcomes po WHERE po.prediction_id = sap.id
      )
    LIMIT ${RESOLVE_BATCH_LIMIT}
  `);
  const missesInserted =
    (missRes as unknown as { affectedRows?: number }).affectedRows ?? 0;

  // Readout · all-time per-arm conversion. This is the A/B lift line the
  // experiment has been missing — treatment (got the cross-sell SMS) vs
  // control (predicted but never contacted).
  let armSplit = "no resolved rows yet";
  try {
    const [splitRows] = await d.execute(sql`
      SELECT sap.ab_arm AS arm,
             COUNT(*) AS resolved,
             SUM(po.matched) AS matched
      FROM prediction_outcomes po
      JOIN service_affinity_predictions sap ON sap.id = po.prediction_id
      GROUP BY sap.ab_arm
    `);
    const rows = splitRows as unknown as Array<{
      arm: string;
      resolved: number;
      matched: number | string | null;
    }>;
    if (rows.length > 0) {
      armSplit = rows
        .map((r) => {
          const resolved = Number(r.resolved) || 0;
          const matched = Number(r.matched) || 0;
          const pct = resolved > 0 ? Math.round((matched / resolved) * 1000) / 10 : 0;
          return `${r.arm}=${matched}/${resolved} (${pct}%)`;
        })
        .join(" · ");
    }
  } catch (err) {
    log.warn("[prediction-outcomes] arm-split readout failed (non-fatal)", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const durMs = Date.now() - start;
  const details = `matched=${matchedInserted} misses=${missesInserted} · arms: ${armSplit}`;
  log.info(`[prediction-outcomes] done in ${durMs}ms · ${details}`);

  return { recordsProcessed: matchedInserted + missesInserted, details };
}
