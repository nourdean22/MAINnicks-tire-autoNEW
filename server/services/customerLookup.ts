/**
 * Customer Lookup Service — Find or create customer records
 * Matches by phone (primary), email (secondary), or ID.
 */

import { eq, like } from "drizzle-orm";
import { createLogger } from "../lib/logger";

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
    const normalized = identifier.phone.replace(/\D/g, "").slice(-10);
    if (normalized.length === 10) {
      const [result] = await db.select().from(customers).where(like(customers.phone, `%${normalized}`)).limit(1);
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

  // ID is auto-increment int — don't pass it, let DB generate
  const result = await db.insert(customers).values({
    firstName,
    lastName,
    phone: data.phone,
    email: data.email?.toLowerCase() ?? undefined,
  });

  // Fetch by phone since we just created with that phone
  const newCustomer = await findCustomer({ phone: data.phone });
  log.info("New customer created", { name: data.name });
  return { customer: newCustomer!, isNew: true };
}
