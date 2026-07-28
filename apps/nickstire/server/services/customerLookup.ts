/**
 * Customer Lookup Service — Find or create customer records
 * Matches by phone (primary), email (secondary), or ID.
 */

import { eq, sql } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { phoneRawDigits } from "../lib/phone";

const log = createLogger("customer-lookup");

/**
 * Find existing customer by phone, email, or ID.
 * Phone matching uses last 10 digits for flexibility.
 */
export async function findCustomer(identifier: { phone?: string; email?: string; id?: number | string }) {
  const { getDb } = await import("../db");
  const { customers } = await import("../../drizzle/schema");
  const db = await getDb();
  if (!db) return null;

  if (identifier.id) {
    const numId = typeof identifier.id === "string" ? parseInt(identifier.id, 10) : identifier.id;
    if (!isNaN(numId)) {
      const [result] = await db.select().from(customers).where(eq(customers.id, numId)).limit(1);
      return result || null;
    }
  }

  if (identifier.phone) {
    // Canonical key = last-10 digits (strips +1 / punctuation / leading country-1).
    const normalized = phoneRawDigits(identifier.phone);
    if (normalized.length === 10) {
      // Normalize BOTH sides in SQL so a row stored in ANY format
      // (E.164 "+1…", punctuated "(216) …", 11-digit "1…") still matches.
      // A bare LIKE '%<last10>' would miss punctuated stored values and is a
      // weaker comparison than the dedup key (RIGHT(REGEXP_REPLACE(...),10)).
      const [result] = await db
        .select()
        .from(customers)
        .where(sql`RIGHT(REGEXP_REPLACE(${customers.phone}, '[^0-9]', ''), 10) = ${normalized}`)
        .limit(1);
      return result || null;
    }
  }

  if (identifier.email) {
    const [result] = await db.select().from(customers).where(eq(customers.email, identifier.email.toLowerCase())).limit(1);
    return result || null;
  }

  return null;
}

/**
 * Find existing customer or create a new one.
 * Returns { customer, isNew } so callers can trigger welcome flows.
 */
export async function findOrCreateCustomer(data: {
  name: string;
  phone: string;
  email?: string;
  source?: string;
}) {
  // Try to find existing
  let customer = await findCustomer({ phone: data.phone });
  if (!customer && data.email) {
    customer = await findCustomer({ email: data.email });
  }

  if (customer) {
    log.info("Existing customer found", { id: customer.id, name: `${customer.firstName} ${customer.lastName}` });
    return { customer, isNew: false };
  }

  // Create new
  const { getDb } = await import("../db");
  const { customers } = await import("../../drizzle/schema");
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const nameParts = data.name.trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || null;

  // Dedup guard (customer-dedup-plan §8): store the phone in ONE canonical
  // format (last-10 digits) so chat/booking E.164 inserts ("+1216…") no longer
  // create a second row alongside an existing 10-digit import row for the same
  // person. The lookup above already normalizes to last-10, so find + insert now
  // agree on the key. Fall back to the raw input only when normalization fails
  // (too-short / non-US numbers) so an unusual number can still create a row.
  const phoneToStore = phoneRawDigits(data.phone) || data.phone;

  // wave-116 — race-safe insert. If two callers hit findOrCreate with
  // the same phone simultaneously, both find no existing customer, both
  // INSERT, duplicate created. Post-migration 0034, the unique
  // constraint causes ER_DUP_ENTRY on the second; we catch and re-find
  // the now-existing customer instead of failing the caller.
  // Pre-migration: behavior unchanged.
  try {
    await db.insert(customers).values({
      firstName,
      lastName,
      phone: phoneToStore,
      email: data.email?.toLowerCase() ?? undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/Duplicate entry|ER_DUP_ENTRY/i.test(msg)) {
      throw err;
    }
    log.warn("Customer race detected in findOrCreate — falling through to lookup", { phone: phoneToStore.slice(-4) });
  }

  // Fetch by phone since we just created with that phone (or found existing).
  // findCustomer re-normalizes, so the original data.phone resolves the new row.
  const newCustomer = await findCustomer({ phone: data.phone });
  log.info("New customer created (or recovered from race)", { name: data.name });
  return { customer: newCustomer!, isNew: true };
}
