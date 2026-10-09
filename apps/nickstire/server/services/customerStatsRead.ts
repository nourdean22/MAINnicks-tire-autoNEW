/**
 * `customer_stats` bridge read: how many customers the shop has on file, and how many made
 * their FIRST visit in the current shop month. Read by StateNour's dashboard summary
 * (`apps/statenour/lib/services/business-intel.ts` `getCustomerStats`), which uses exactly
 * these two numbers.
 *
 * StateNour called this query from v10.0.51 and nickstire never registered it, so every call
 * was a 400 and the summary's customer section was redacted as unknown (found 2026-10-08 by
 * the bridge contract test). Built minimal on purpose: the old StateNour type also asked for
 * `withPhone`, `returning` and a `topCustomers` list with names and phones, and nothing ever
 * read them, so they are not sent.
 *
 * "New this month" is `customers.firstVisitDate` (the earliest invoice date, maintained by
 * `services/dataPipelines.ts`) inside the shop's calendar month in America/New_York, read as
 * the stored shop-local day, the same contract the invoice reads use. Not `createdAt`: an
 * import creates records in bulk, so a record's age is not a visit.
 *
 * A database that cannot be read THROWS, so the bridge answers 500 and StateNour reports the
 * section as unknown. A soft `{ error }` body with status 200 would be counted as zero
 * customers by any consumer that only checks the HTTP status.
 */
import { sql } from "drizzle-orm";
import { BUSINESS } from "../../shared/business";
import { readRows } from "../lib/dbResult";

const NEW_THIS_MONTH_MEANS =
  "customers whose first invoice falls in the current calendar month, America/New_York";

export interface CustomerStats {
  total: number;
  newThisMonth: number;
  /** First day of the shop month counted, YYYY-MM-DD (America/New_York). */
  monthStart: string;
  newThisMonthMeans: string;
}

/** First day of the shop's calendar month containing `now`, and of the next one (YYYY-MM-DD). */
/** The shop's calendar month around `now` (America/New_York), as stored shop-local days. */
export function shopMonthBounds(now: Date): { lastMonthStart: string; monthStart: string; nextMonthStart: string } {
  const today = now.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const lastYear = month === 1 ? year - 1 : year;
  const lastMonth = month === 1 ? 12 : month - 1;
  return {
    lastMonthStart: `${lastYear}-${pad(lastMonth)}-01`,
    monthStart: `${year}-${pad(month)}-01`,
    nextMonthStart: `${nextYear}-${pad(nextMonth)}-01`,
  };
}

interface Executor {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}

export async function readCustomerStats(db: Executor | null | undefined, now: Date = new Date()): Promise<CustomerStats> {
  if (!db) throw new Error("customer_stats: the shop database is unavailable");
  const { monthStart, nextMonthStart } = shopMonthBounds(now);
  const result = await db.execute(sql`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN firstVisitDate >= ${monthStart} AND firstVisitDate < ${nextMonthStart}
                             THEN 1 ELSE 0 END), 0) AS newThisMonth
    FROM customers
  `);
  const row = readRows(result)[0];
  if (!row) throw new Error("customer_stats: the customer count returned no row");
  const total = Number(row.total);
  const newThisMonth = Number(row.newThisMonth);
  if (!Number.isFinite(total) || !Number.isFinite(newThisMonth)) {
    throw new Error("customer_stats: the customer count was not a number");
  }
  return { total, newThisMonth, monthStart, newThisMonthMeans: NEW_THIS_MONTH_MEANS };
}
