import { eq, sql } from "drizzle-orm";

import { phoneRawDigits } from "./phone";

/**
 * Resolve a `work_orders.customer_id` to its customer row.
 *
 * wave-182 — `work_orders.customer_id` is a polymorphic varchar: it holds
 * EITHER a numeric `customers.id`, a raw phone string (AI-chat / walk-in WOs),
 * or the "WALK-IN" sentinel. The SMS/review send paths used to do only
 * `parseInt(customer_id)` → lookup-by-id, so every phone-keyed walk-in job
 * silently missed its drop-off / pickup / decline-recovery text (and the
 * drop-off flow actually threw). This resolves BOTH forms — numeric id first,
 * then a last-10-digit phone fallback — mirroring the proven getTrackingInfo()
 * pattern. Returns the full customer row, or null for a truly anonymous
 * walk-in (the "WALK-IN" sentinel / no resolvable customer).
 *
 * Self-contained (loads its own db + schema) so any send path can call it with
 * just the work order's customer_id.
 */
export async function resolveWorkOrderCustomer(customerId: string | null | undefined) {
  if (!customerId) return null;

  const { getDb } = await import("../db");
  const { customers } = await import("../../drizzle/schema");
  const db = await getDb();
  if (!db) return null;

  // 1. Numeric customers.id (the common case — resolved at WO-write time).
  const numeric = parseInt(customerId, 10);
  if (!isNaN(numeric)) {
    const [byId] = await db.select().from(customers).where(eq(customers.id, numeric)).limit(1);
    if (byId) return byId;
  }

  // 2. Phone fallback — AI-chat / walk-in WOs store a raw phone string. A
  //    10-digit phone also parses as an int above, but no real customers.id is
  //    that large, so the id lookup misses and we land here. "WALK-IN" yields
  //    no digits and is correctly left unresolved.
  const phone10 = phoneRawDigits(customerId);
  if (phone10.length === 10) {
    const [byPhone] = await db
      .select()
      .from(customers)
      .where(sql`RIGHT(REGEXP_REPLACE(${customers.phone}, '[^0-9]', ''), 10) = ${phone10}`)
      .limit(1);
    if (byPhone) return byPhone;
  }

  return null;
}
