import { sql, type SQL } from "drizzle-orm";
import { customers } from "../../drizzle/schema";

/**
 * THE single definition of a "lapsed" / AT-RISK customer: last visit 90–365
 * days ago. Computed LIVE rather than read from the materialized `segment`
 * enum column — that column is refreshed only by the enrich-customer-data
 * cron, so it goes stale and read 0 while at-risk rows were clearly present.
 *
 * Matches the AT-RISK row badge in StatusBadge.tsx (older than 365 days = LOST,
 * a separate bucket). Every "lapsed" count / filter / export must use this so
 * the KPI, the list, the export, and the LTV drilldown can never disagree.
 */
export function lapsedCondition(): SQL {
  return sql`${customers.lastVisitDate} < DATE_SUB(NOW(), INTERVAL 90 DAY) AND ${customers.lastVisitDate} >= DATE_SUB(NOW(), INTERVAL 365 DAY)`;
}
