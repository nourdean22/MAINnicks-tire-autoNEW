import { sql, type SQL } from "drizzle-orm";
import { tireOrders } from "../../drizzle/schema";

/**
 * tire_orders.adminNotes with one more line, appended IN SQL. Reading the notes, calling a supplier
 * and writing them back loses any note staff added in between; this cannot.
 */
export function appendAdminNote(line: string): SQL {
  return sql`CONCAT_WS(${"\n"}, NULLIF(${tireOrders.adminNotes}, ''), ${line})`;
}
