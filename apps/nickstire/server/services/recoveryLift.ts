/**
 * Recovery lift measurement — treated vs holdout (Recovery 2.0).
 *
 * The ONLY honest way to claim the recovery SMS makes money: compare
 * matched-invoice rates between estimates the cron texted (treated,
 * recovery_holdout=0 with ≥1 touch sent) and the deterministic control
 * group it deliberately never texted (recovery_holdout=1).
 *
 * Epistemic contract:
 *   - Raw counts + rates only. NO significance theater, NO projected
 *     dollars. The report carries its own sample-size caveat and a
 *     machine-readable `readable` flag (both arms ≥ 30) so downstream
 *     surfaces don't quote noise.
 *   - "Converted" = matched_invoice_id set — the same truth standard the
 *     rest of the revenue stack uses. Nothing softer counts.
 *   - Returns zeros gracefully before migration 0100 / before the cron
 *     has assigned anyone.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("recovery-lift");

export interface RecoveryLiftArm {
  n: number;
  converted: number;
  /** matched-invoice rate 0-100, null when n = 0 */
  ratePct: number | null;
}

export interface RecoveryLiftReport {
  windowDays: number;
  treated: RecoveryLiftArm;   // holdout=0 AND at least one touch sent
  eligibleUntouched: number;  // holdout=0 but no touch sent yet (in-flight)
  holdout: RecoveryLiftArm;   // holdout=1 — never contacted by the cron
  unassigned: number;         // holdout IS NULL — not yet through the cron
  /** true only when both arms have ≥30 rows — below that, treat the
   *  rates as noise, not signal. */
  readable: boolean;
  note: string;
}

export async function getRecoveryLiftReport(windowDays = 90): Promise<RecoveryLiftReport> {
  const empty: RecoveryLiftArm = { n: 0, converted: 0, ratePct: null };
  const base: RecoveryLiftReport = {
    windowDays,
    treated: { ...empty },
    eligibleUntouched: 0,
    holdout: { ...empty },
    unassigned: 0,
    readable: false,
    note:
      "Lift = treated vs holdout matched-invoice rates. Rates are raw; " +
      "readable=false means an arm is under 30 rows — do not quote the numbers as lift yet.",
  };

  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return base;

  try {
    const result = await db.execute(sql`
      SELECT
        recovery_holdout AS holdout,
        (follow_up_3d_sent + follow_up_7d_sent + follow_up_14d_sent + follow_up_30d_sent + follow_up_45d_sent) > 0 AS touched,
        COUNT(*) AS n,
        SUM(matched_invoice_id IS NOT NULL) AS converted
      FROM alg_estimates
      WHERE estimate_date >= DATE_SUB(NOW(), INTERVAL ${windowDays} DAY)
      GROUP BY holdout, touched
    `);
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as Array<{
      holdout: number | null;
      touched: number;
      n: number;
      converted: number;
    }>;

    for (const r of rows) {
      const n = Number(r.n ?? 0);
      const converted = Number(r.converted ?? 0);
      if (r.holdout === null || r.holdout === undefined) {
        base.unassigned += n;
      } else if (Number(r.holdout) === 1) {
        base.holdout.n += n;
        base.holdout.converted += converted;
      } else if (Number(r.touched) === 1) {
        base.treated.n += n;
        base.treated.converted += converted;
      } else {
        base.eligibleUntouched += n;
      }
    }

    base.treated.ratePct = base.treated.n > 0 ? Math.round((base.treated.converted / base.treated.n) * 1000) / 10 : null;
    base.holdout.ratePct = base.holdout.n > 0 ? Math.round((base.holdout.converted / base.holdout.n) * 1000) / 10 : null;
    base.readable = base.treated.n >= 30 && base.holdout.n >= 30;
    return base;
  } catch (err) {
    // Pre-0100 environments: column doesn't exist yet — report empties.
    const msg = err instanceof Error ? err.message : String(err);
    if (/unknown column|doesn'?t exist|1054|1146/i.test(msg)) {
      log.warn("[recovery-lift] 0100 columns absent — returning empty report");
      return base;
    }
    throw err;
  }
}
