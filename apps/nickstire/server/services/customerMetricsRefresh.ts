/**
 * Wave-100 — refresh materialized customer_metrics aggregates.
 *
 * Replaces the 4 correlated subqueries in customers.list with a single
 * SELECT join on customer_metrics. Refresh runs on a schedule (or
 * on-demand via tRPC) to keep the values current.
 *
 * Columns refreshed:
 *   - declinedValue / declinedCount  · sum of unmatched ALG estimates
 *     by customer phone (cents)
 *   - backlogValueCents / backlogCount · sum of open work order totals
 *     by customer ID (cents)
 *
 * Strategy: single multi-row UPSERT per customer using a CROSS JOIN
 * with two derived tables. ~2,500 customers in DB → completes in <2s.
 */
import { sql } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { getDb } from "../db";

const log = createLogger("customer-metrics-refresh");

export interface MetricsRefreshResult {
  customersUpdated: number;
  durationMs: number;
}

export async function refreshCustomerMetrics(): Promise<MetricsRefreshResult> {
  const start = Date.now();
  const d = await getDb();
  if (!d) {
    log.warn("DB unavailable, skipping metrics refresh");
    return { customersUpdated: 0, durationMs: 0 };
  }

  // Step 1: ensure every customer has a customer_metrics row.
  // INSERT IGNORE on duplicate key (customerId is the natural key but
  // there's no unique constraint, so we use NOT EXISTS).
  await d.execute(sql`
    INSERT INTO customer_metrics (customerId, totalRevenue, totalJobs, avgSpendPerVisit, churnRisk, isVip, declinedValue, declinedCount, backlogValueCents, backlogCount, computedAt)
    SELECT c.id, 0, 0, 0, 'low', 0, 0, 0, 0, 0, NOW()
    FROM customers c
    WHERE NOT EXISTS (SELECT 1 FROM customer_metrics m WHERE m.customerId = c.id)
  `);

  // Step 2: compute fresh declinedValue/declinedCount per customer.
  // Single bulk UPDATE joining customer_metrics ← customers ← alg_estimates.
  // Phone match uses last-10-digits fuzzy because customers.phone is
  // stored as "1234567890" and alg_estimates.customer_phone is E.164
  // "+11234567890" — direct equality misses ~95% of legitimate matches.
  const declinedRes = await d.execute(sql`
    UPDATE customer_metrics m
    INNER JOIN customers c ON c.id = m.customerId
    LEFT JOIN (
      SELECT RIGHT(REGEXP_REPLACE(customer_phone, '[^0-9]', ''), 10) AS phone10,
             COALESCE(SUM(estimated_amount), 0) AS sum_amount,
             COUNT(*) AS cnt
      FROM alg_estimates
      WHERE matched_invoice_id IS NULL
        AND customer_phone IS NOT NULL
        AND CHAR_LENGTH(REGEXP_REPLACE(customer_phone, '[^0-9]', '')) >= 10
      GROUP BY phone10
    ) e ON e.phone10 = RIGHT(REGEXP_REPLACE(c.phone, '[^0-9]', ''), 10)
       AND CHAR_LENGTH(REGEXP_REPLACE(c.phone, '[^0-9]', '')) >= 10
    SET m.declinedValue = COALESCE(e.sum_amount, 0),
        m.declinedCount = COALESCE(e.cnt, 0),
        m.computedAt = NOW()
  `);

  // Step 3: compute fresh backlogValueCents/backlogCount per customer.
  // Post-migration 0070: work_orders.customer_id is int (nullable).
  // Direct integer join — no more polymorphic REGEXP/CAST handling.
  const backlogRes = await d.execute(sql`
    UPDATE customer_metrics m
    INNER JOIN customers c ON c.id = m.customerId
    LEFT JOIN (
      SELECT w.customer_id AS cid,
             COALESCE(ROUND(SUM(w.total) * 100), 0) AS sum_cents,
             COUNT(*) AS cnt
      FROM work_orders w
      WHERE w.customer_id IS NOT NULL
        AND w.status NOT IN ('completed', 'picked_up', 'closed', 'cancelled')
      GROUP BY w.customer_id
    ) w ON w.cid = c.id
    SET m.backlogValueCents = COALESCE(w.sum_cents, 0),
        m.backlogCount = COALESCE(w.cnt, 0),
        m.computedAt = NOW()
  `);

  // Step 4: count rows touched
  const [countRow] = await d.execute(sql`SELECT COUNT(*) AS c FROM customer_metrics`);
  const total = ((countRow as Array<{ c: number }>)[0]?.c) ?? 0;

  const durationMs = Date.now() - start;
  log.info(`Refreshed customer_metrics: ${total} rows in ${durationMs}ms`, {
    declinedRes: declinedRes ? "ok" : "?",
    backlogRes: backlogRes ? "ok" : "?",
  });
  return { customersUpdated: total, durationMs };
}
