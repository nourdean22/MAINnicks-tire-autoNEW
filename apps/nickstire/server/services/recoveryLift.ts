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
  /** Strike-5: the versioned experiment readout. Everything above mixes
   *  legacy %-modulo rows; this block reads ONLY rows stamped with an
   *  experiment version + assignment time. */
  v3: RecoveryExperimentV3Report;
}

export interface RecoveryExperimentV3Report {
  version: "v3";
  /** PRIMARY: intention-to-treat — every assigned row counts in its arm,
   *  touched or not. Per-protocol comparisons bias toward reachable
   *  customers; ITT measures the POLICY. */
  itt: { treatment: RecoveryLiftArm; control: RecoveryLiftArm };
  /** SECONDARY: treatment rows that actually received ≥1 touch. */
  perProtocolTreated: RecoveryLiftArm;
  /** Assigned-treatment rows with zero touches so far (in-flight). */
  treatmentUntouched: number;
  /** Conversions count ONLY when the matched invoice is dated on/after
   *  assignment — a backfilled match that predates assignment is not an
   *  experiment outcome. */
  outcomeRule: string;
  readable: boolean;
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
      "readable=false means an arm is under 30 rows — do not quote the numbers as lift yet. " +
      "Prefer the v3 block: versioned rows only, ITT primary, post-assignment outcomes.",
    v3: {
      version: "v3",
      itt: { treatment: { ...empty }, control: { ...empty } },
      perProtocolTreated: { ...empty },
      treatmentUntouched: 0,
      outcomeRule: "converted = matched invoice dated on/after recovery_assigned_at",
      readable: false,
    },
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

    // ── v3 block: versioned rows only, assignment-anchored ──
    try {
      const v3res = await db.execute(sql`
        SELECT
          e.recovery_holdout AS holdout,
          (e.follow_up_3d_sent + e.follow_up_7d_sent + e.follow_up_14d_sent + e.follow_up_30d_sent + e.follow_up_45d_sent) > 0 AS touched,
          COUNT(*) AS n,
          SUM(inv.id IS NOT NULL AND inv.invoiceDate >= e.recovery_assigned_at) AS converted
        FROM alg_estimates e
        LEFT JOIN invoices inv ON inv.id = e.matched_invoice_id
        WHERE e.recovery_experiment_version = 'v3'
          AND e.recovery_assigned_at >= DATE_SUB(NOW(), INTERVAL ${windowDays} DAY)
        GROUP BY holdout, touched
      `);
      const v3rows = (Array.isArray(v3res) && Array.isArray(v3res[0]) ? v3res[0] : v3res) as Array<{
        holdout: number | null; touched: number; n: number; converted: number;
      }>;
      const v3 = base.v3;
      for (const r of v3rows) {
        const n = Number(r.n ?? 0);
        const converted = Number(r.converted ?? 0);
        if (Number(r.holdout) === 1) {
          v3.itt.control.n += n;
          v3.itt.control.converted += converted;
        } else {
          // ITT: EVERY assigned-treatment row counts, touched or not.
          v3.itt.treatment.n += n;
          v3.itt.treatment.converted += converted;
          if (Number(r.touched) === 1) {
            v3.perProtocolTreated.n += n;
            v3.perProtocolTreated.converted += converted;
          } else {
            v3.treatmentUntouched += n;
          }
        }
      }
      const rate = (a: RecoveryLiftArm) => (a.n > 0 ? Math.round((a.converted / a.n) * 1000) / 10 : null);
      v3.itt.treatment.ratePct = rate(v3.itt.treatment);
      v3.itt.control.ratePct = rate(v3.itt.control);
      v3.perProtocolTreated.ratePct = rate(v3.perProtocolTreated);
      v3.readable = v3.itt.treatment.n >= 30 && v3.itt.control.n >= 30;
    } catch (v3err) {
      const v3msg = v3err instanceof Error ? v3err.message : String(v3err);
      if (!/unknown column|doesn'?t exist|1054|1146/i.test(v3msg)) throw v3err;
      log.warn("[recovery-lift] 0103 columns absent — v3 block empty");
    }
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
