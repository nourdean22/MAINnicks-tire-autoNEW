/**
 * Cron: Customer Segmentation — Weekly re-segmentation
 * Classifies every customer into a segment based on recency of last visit.
 * Segments: recent (0-90d), lapsed (91-365d), new (no visits yet), unknown (>365d or no data).
 */
import { createLogger } from "../../lib/logger";
import { sql } from "drizzle-orm";

const log = createLogger("cron:segmentation");

export async function processCustomerSegmentation(): Promise<{ recordsProcessed: number }> {
  try {
    const { getDb } = await import("../../db");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0 };

    // Bulk update all segments in 4 SQL statements for efficiency

    // 1. recent: visited in last 90 days
    const recentResult = await db.execute(sql`
      UPDATE customers
      SET segment = 'recent'
      WHERE lastVisitDate IS NOT NULL
        AND DATEDIFF(CURDATE(), lastVisitDate) <= 90
    `);

    // 2. lapsed: visited 91-365 days ago
    const lapsedResult = await db.execute(sql`
      UPDATE customers
      SET segment = 'lapsed'
      WHERE lastVisitDate IS NOT NULL
        AND DATEDIFF(CURDATE(), lastVisitDate) BETWEEN 91 AND 365
    `);

    // 3. unknown: visited >365 days ago
    await db.execute(sql`
      UPDATE customers
      SET segment = 'unknown'
      WHERE lastVisitDate IS NOT NULL
        AND DATEDIFF(CURDATE(), lastVisitDate) > 365
    `);

    // 4. new: no visits recorded (no lastVisitDate)
    await db.execute(sql`
      UPDATE customers
      SET segment = 'new'
      WHERE lastVisitDate IS NULL
    `);

    const affected =
      ((recentResult as any)[0]?.affectedRows ?? 0) +
      ((lapsedResult as any)[0]?.affectedRows ?? 0);

    log.info(`Customer segmentation complete — recent+lapsed rows updated: ${affected}`);
    return { recordsProcessed: affected };
  } catch (err) {
    log.error("Customer segmentation failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0 };
  }
}
