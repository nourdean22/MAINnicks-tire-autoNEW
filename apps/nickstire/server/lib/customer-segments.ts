import { sql, type SQL } from "drizzle-orm";
import { customers } from "../../drizzle/schema";
import type { DB } from "../db";
import { campaignEligiblePhoneSql } from "./sms-eligibility";
import { LAPSED_MAX_DAYS, LAPSED_MIN_DAYS, VIP_MIN_VISITS } from "../../shared/customerSegments";

/**
 * THE single definition of a "lapsed" / AT-RISK customer: last visit 90 to 365
 * days ago (older is LOST, as the StatusBadge AT-RISK badge shows). Computed live,
 * never from the materialized `segment` column, which only the enrich cron
 * refreshes and which read 0 while at-risk rows were present. Every lapsed count,
 * filter and export uses this so the KPI, list, export and drilldown agree.
 */
export function lapsedCondition(): SQL {
  return sql`${customers.lastVisitDate} < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(LAPSED_MIN_DAYS))} DAY) AND ${customers.lastVisitDate} >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(LAPSED_MAX_DAYS))} DAY)`;
}

/** A VIP / regular: 3+ visits (mirrored closed invoices). */
export function vipCondition(): SQL {
  return sql`${customers.totalVisits} >= ${sql.raw(String(VIP_MIN_VISITS))}`;
}

/** A regular who has lapsed: the Win-Back audience the Customers tab counts (winback.ts targets it). */
export function lapsedRegularCondition(): SQL {
  return sql`(${vipCondition()}) AND (${lapsedCondition()})`;
}

/**
 * Lapsed regulars, and how many of them can be texted (the canonical opt-out
 * predicate). customers.stats and the Customers insight both read this, so the
 * banner and the roster count the same people.
 */
export async function countLapsedRegulars(d: DB): Promise<{ qualifying: number; contactable: number }> {
  const count = sql<number>`count(*)`;
  const [[qualifying], [contactable]] = await Promise.all([
    d.select({ count }).from(customers).where(lapsedRegularCondition()),
    d.select({ count }).from(customers).where(sql`${lapsedRegularCondition()} AND ${campaignEligiblePhoneSql}`),
  ]);
  return { qualifying: Number(qualifying?.count ?? 0), contactable: Number(contactable?.count ?? 0) };
}
