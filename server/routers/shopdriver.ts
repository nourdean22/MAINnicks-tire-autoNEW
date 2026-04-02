/**
 * ShopDriver Integration router — Deep CRM sync engine.
 * - CSV import (existing)
 * - Web scraping for real-time ticket/invoice data
 * - Customer sync between website and ShopDriver Elite
 * - Invoice sync for Revenue Center
 * - Auto-sync scheduler
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, sql, desc, and, isNull } from "drizzle-orm";
import { customers, shopSettings, customerImportLog, invoices, bookings } from "../../drizzle/schema";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

/** Normalize phone to E.164 format */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Classify customer segment based on last visit date */
function classifySegment(lastVisitStr: string | null | undefined): "recent" | "lapsed" | "unknown" {
  if (!lastVisitStr) return "unknown";
  const d = new Date(lastVisitStr);
  if (isNaN(d.getTime())) return "unknown";
  const daysSince = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince <= 365) return "recent";
  return "lapsed";
}

/** Parse a CSV string into rows (handles quoted fields) */
function parseCSV(csv: string): string[][] {
  const rows: string[][] = [];
  const lines = csv.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());
    rows.push(fields);
  }
  return rows;
}

// ─── SHOPDRIVER WEB SCRAPING ENGINE ────────────────────
const SD_BASE = "https://secure.autolaborexperts.com";
let sdSessionCookie: string | null = null;
let sdSessionExpiry = 0;

async function sdLogin(): Promise<boolean> {
  const username = process.env.AUTO_LABOR_USERNAME;
  const password = process.env.AUTO_LABOR_PASSWORD;
  if (!username || !password) return false;

  try {
    const res = await fetch(`${SD_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      redirect: "manual",
    });

    // Extract session cookie from Set-Cookie header
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      sdSessionCookie = setCookie.split(";")[0];
      sdSessionExpiry = Date.now() + 30 * 60 * 1000; // 30 min
      return true;
    }

    // Some systems return a token in the body
    if (res.ok) {
      try {
        const body = await res.json();
        if (body.token || body.session) {
          sdSessionCookie = `token=${body.token || body.session}`;
          sdSessionExpiry = Date.now() + 30 * 60 * 1000;
          return true;
        }
      } catch { /* response not JSON — expected for some auth flows */ }
    }

    return false;
  } catch (err) {
    console.error("[ShopDriver] Login failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function sdFetch(path: string): Promise<Response | null> {
  if (!sdSessionCookie || Date.now() > sdSessionExpiry) {
    const ok = await sdLogin();
    if (!ok) return null;
  }

  try {
    return await fetch(`${SD_BASE}${path}`, {
      headers: {
        Cookie: sdSessionCookie || "",
        Accept: "application/json",
      },
    });
  } catch (err) {
    console.error("[ShopDriver] Fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── SYNC STATE TRACKING ───────────────────────────────
interface SyncResult {
  type: "customers" | "invoices" | "tickets";
  synced: number;
  updated: number;
  errors: number;
  timestamp: number;
}

const syncHistory: SyncResult[] = [];

export const shopdriverRouter = router({
  // ═══════════════════════════════════════════════════════
  // EXISTING: CSV Import
  // ═══════════════════════════════════════════════════════

  /** Import customers from ShopDriver Elite CSV export */
  importCSV: adminProcedure
    .input(z.object({
      csvContent: z.string().min(10),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "Database unavailable" };

      const rows = parseCSV(input.csvContent);
      if (rows.length < 2) return { success: false, error: "CSV has no data rows" };

      const headers = rows[0].map(h => h.toLowerCase().trim());
      const dataRows = rows.slice(1);

      // Create import log entry
      const [logEntry] = await d.insert(customerImportLog).values({
        totalRows: dataRows.length,
        source: "shopdriver_csv",
        status: "processing",
        importedBy: "admin",
      });
      const logId = logEntry.insertId;

      // Map ShopDriver CSV headers to our fields
      const colMap: Record<string, number> = {};
      const fieldMappings: Record<string, string[]> = {
        firstName: ["first name", "first", "firstname"],
        lastName: ["last name", "last", "lastname"],
        phone: ["phone", "phone1", "mobile", "cell", "telephone"],
        phone2: ["phone 2", "phone2", "alt phone", "alternate phone"],
        email: ["email", "e-mail", "email address"],
        address: ["address", "street", "address1", "street address"],
        city: ["city"],
        state: ["state", "st"],
        zip: ["zip", "zip code", "zipcode", "postal"],
        customerType: ["type", "customer type", "customertype"],
        totalVisits: ["visits", "total visits", "visit count", "totalvisits"],
        lastVisitDate: ["last visit", "last visit date", "lastvisit", "lastvisitdate"],
        balanceDue: ["balance", "balance due", "balancedue", "amount due"],
        alsCustomerId: ["id", "customer id", "customerid", "cust id", "custid", "account"],
      };

      for (const [field, aliases] of Object.entries(fieldMappings)) {
        for (const alias of aliases) {
          const idx = headers.indexOf(alias);
          if (idx !== -1) {
            colMap[field] = idx;
            break;
          }
        }
      }

      if (colMap.firstName === undefined && colMap.lastName === undefined) {
        await d.update(customerImportLog)
          .set({ status: "failed", errorMessage: "CSV missing name columns" })
          .where(eq(customerImportLog.id, Number(logId)));
        return { success: false, error: "CSV must have First Name or Last Name column" };
      }
      if (colMap.phone === undefined) {
        await d.update(customerImportLog)
          .set({ status: "failed", errorMessage: "CSV missing phone column" })
          .where(eq(customerImportLog.id, Number(logId)));
        return { success: false, error: "CSV must have a Phone column" };
      }

      let newCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const row of dataRows) {
        try {
          const getValue = (field: string) => {
            const idx = colMap[field];
            return idx !== undefined && idx < row.length ? row[idx] : null;
          };

          const rawPhone = getValue("phone") || "";
          const phone = normalizePhone(rawPhone);
          if (!phone) {
            skippedCount++;
            continue;
          }

          const firstName = getValue("firstName") || "Customer";
          const lastName = getValue("lastName") || null;
          const email = getValue("email") || null;
          const address = getValue("address") || null;
          const city = getValue("city") || null;
          const state = getValue("state") || null;
          const zip = getValue("zip") || null;
          const phone2Raw = getValue("phone2");
          const phone2 = phone2Raw ? normalizePhone(phone2Raw) : null;
          const customerType = (getValue("customerType") || "").toLowerCase().includes("commercial") ? "commercial" as const : "individual" as const;
          const totalVisits = parseInt(getValue("totalVisits") || "0") || 0;
          const lastVisitStr = getValue("lastVisitDate");
          const lastVisitDate = lastVisitStr ? new Date(lastVisitStr) : null;
          const balanceDue = Math.round(parseFloat(getValue("balanceDue") || "0") * 100) || 0;
          const alsCustomerId = getValue("alsCustomerId") || null;
          const segment = classifySegment(lastVisitStr);

          const existing = await d.select({ id: customers.id })
            .from(customers)
            .where(eq(customers.phone, phone))
            .limit(1);

          if (existing.length > 0) {
            await d.update(customers).set({
              firstName, lastName, email, address, city, state, zip,
              phone2, customerType, totalVisits,
              lastVisitDate: lastVisitDate && !isNaN(lastVisitDate.getTime()) ? lastVisitDate : undefined,
              balanceDue, alsCustomerId, segment,
            }).where(eq(customers.id, existing[0].id));
            updatedCount++;
          } else {
            await d.insert(customers).values({
              firstName, lastName, phone, phone2, email, address, city, state, zip,
              customerType, totalVisits,
              lastVisitDate: lastVisitDate && !isNaN(lastVisitDate.getTime()) ? lastVisitDate : undefined,
              balanceDue, alsCustomerId, segment,
            });
            newCount++;
          }
        } catch (err) {
          console.warn("[ShopDriver] Customer import row skipped:", err instanceof Error ? err.message : err);
          skippedCount++;
        }
      }

      await d.update(customerImportLog).set({
        newCustomers: newCount,
        updatedCustomers: updatedCount,
        skippedRows: skippedCount,
        status: "completed",
      }).where(eq(customerImportLog.id, Number(logId)));

      return {
        success: true,
        totalRows: dataRows.length,
        newCustomers: newCount,
        updatedCustomers: updatedCount,
        skippedRows: skippedCount,
      };
    }),

  /** Get import history */
  importHistory: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    return d.select().from(customerImportLog).orderBy(sql`${customerImportLog.createdAt} DESC`).limit(20);
  }),

  // ═══════════════════════════════════════════════════════
  // NEW: Real-Time CRM Sync
  // ═══════════════════════════════════════════════════════

  /** Sync recent tickets/invoices from ShopDriver Elite */
  syncInvoices: adminProcedure.mutation(async () => {
    const d = await db();
    if (!d) return { success: false, error: "Database unavailable", synced: 0 };

    // Try to fetch recent tickets from ShopDriver API
    const res = await sdFetch("/api/tickets?limit=50&sort=-createdAt");

    if (!res || !res.ok) {
      return {
        success: false,
        error: "Could not connect to ShopDriver. Use CSV import as fallback.",
        synced: 0,
        hint: "Export invoices from ShopDriver → Manage → Reports → Invoice Report, then import via CSV.",
      };
    }

    try {
      const data = await res.json();
      const tickets = Array.isArray(data) ? data : data.tickets || data.data || [];
      let synced = 0;
      let updated = 0;

      for (const ticket of tickets) {
        const invoiceNumber = String(ticket.invoiceNumber || ticket.id || ticket.ticketNumber || "");
        if (!invoiceNumber) continue;

        // Check if invoice already exists
        const existing = await d.select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.invoiceNumber, invoiceNumber))
          .limit(1);

        const amount = Math.round(parseFloat(ticket.total || ticket.grandTotal || ticket.amount || "0") * 100);
        const customerName = [ticket.customerFirstName || ticket.firstName, ticket.customerLastName || ticket.lastName].filter(Boolean).join(" ") || "Unknown";
        const customerPhone = ticket.customerPhone || ticket.phone || "";
        const vehicle = [ticket.vehicleYear, ticket.vehicleMake, ticket.vehicleModel].filter(Boolean).join(" ") || "";
        const services = ticket.lineItems?.map((li: any) => li.description || li.name).join(", ") || ticket.description || "";

        if (existing.length > 0) {
          await d.update(invoices).set({
            totalAmount: amount,
            paymentStatus: ticket.status === "paid" || ticket.paid ? "paid" : "pending",
            serviceDescription: services || undefined,
          }).where(eq(invoices.id, existing[0].id));
          updated++;
        } else {
          const pm = (ticket.paymentMethod || "").toLowerCase();
          const paymentMethod: "cash" | "card" | "check" | "financing" | "other" =
            pm.includes("cash") ? "cash" :
            pm.includes("card") || pm.includes("credit") || pm.includes("debit") ? "card" :
            pm.includes("check") ? "check" :
            pm.includes("financ") ? "financing" : "other";

          await d.insert(invoices).values({
            invoiceNumber,
            customerName,
            customerPhone: normalizePhone(customerPhone) || customerPhone,
            vehicleInfo: vehicle,
            totalAmount: amount,
            paymentStatus: ticket.status === "paid" || ticket.paid ? "paid" : "pending",
            paymentMethod,
            source: "shopdriver",
            serviceDescription: services,
          });
          synced++;
        }
      }

      syncHistory.push({
        type: "invoices",
        synced,
        updated,
        errors: 0,
        timestamp: Date.now(),
      });

      return { success: true, synced, updated, total: tickets.length };
    } catch (err) {
      console.error("[ShopDriver] Invoice sync parse failed:", err instanceof Error ? err.message : err);
      return { success: false, error: "Failed to parse ShopDriver response", synced: 0 };
    }
  }),

  /** Sync customer data from ShopDriver Elite */
  syncCustomers: adminProcedure.mutation(async () => {
    const d = await db();
    if (!d) return { success: false, error: "Database unavailable", synced: 0 };

    const res = await sdFetch("/api/customers?limit=100&sort=-updatedAt");

    if (!res || !res.ok) {
      return {
        success: false,
        error: "Could not connect to ShopDriver. Use CSV import as fallback.",
        synced: 0,
      };
    }

    try {
      const data = await res.json();
      const customerList = Array.isArray(data) ? data : data.customers || data.data || [];
      let newCount = 0;
      let updatedCount = 0;

      for (const cust of customerList) {
        const rawPhone = cust.phone || cust.phone1 || cust.mobile || "";
        const phone = normalizePhone(rawPhone);
        if (!phone) continue;

        const firstName = cust.firstName || cust.first_name || "Customer";
        const lastName = cust.lastName || cust.last_name || null;

        const existing = await d.select({ id: customers.id })
          .from(customers)
          .where(eq(customers.phone, phone))
          .limit(1);

        if (existing.length > 0) {
          await d.update(customers).set({
            firstName,
            lastName,
            email: cust.email || undefined,
            address: cust.address || cust.street || undefined,
            city: cust.city || undefined,
            state: cust.state || undefined,
            zip: cust.zip || cust.zipCode || undefined,
            alsCustomerId: String(cust.id || cust.customerId || ""),
          }).where(eq(customers.id, existing[0].id));
          updatedCount++;
        } else {
          await d.insert(customers).values({
            firstName,
            lastName,
            phone,
            email: cust.email || null,
            address: cust.address || cust.street || null,
            city: cust.city || null,
            state: cust.state || null,
            zip: cust.zip || cust.zipCode || null,
            alsCustomerId: String(cust.id || cust.customerId || ""),
            segment: "unknown",
          });
          newCount++;
        }
      }

      syncHistory.push({
        type: "customers",
        synced: newCount,
        updated: updatedCount,
        errors: 0,
        timestamp: Date.now(),
      });

      return { success: true, newCustomers: newCount, updatedCustomers: updatedCount };
    } catch (err) {
      console.error("[ShopDriver] Customer sync parse failed:", err instanceof Error ? err.message : err);
      return { success: false, error: "Failed to parse customer data", synced: 0 };
    }
  }),

  /** Get sync status and history */
  syncStatus: adminProcedure.query(async () => {
    const d = await db();
    const customerCount = d ? await d.select({ count: sql<number>`count(*)` }).from(customers) : [{ count: 0 }];
    const invoiceCount = d ? await d.select({ count: sql<number>`count(*)` }).from(invoices) : [{ count: 0 }];
    const bookingCount = d ? await d.select({ count: sql<number>`count(*)` }).from(bookings) : [{ count: 0 }];

    return {
      connected: !!process.env.AUTO_LABOR_USERNAME,
      lastSync: syncHistory.length > 0 ? syncHistory[syncHistory.length - 1] : null,
      recentSyncs: syncHistory.slice(-10).reverse(),
      counts: {
        customers: customerCount[0]?.count || 0,
        invoices: invoiceCount[0]?.count || 0,
        bookings: bookingCount[0]?.count || 0,
      },
    };
  }),

  /** Manual invoice import from CSV (fallback when API isn't available) */
  importInvoiceCSV: adminProcedure
    .input(z.object({
      csvContent: z.string().min(10),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "Database unavailable" };

      const rows = parseCSV(input.csvContent);
      if (rows.length < 2) return { success: false, error: "CSV has no data rows" };

      const headers = rows[0].map(h => h.toLowerCase().trim());
      const dataRows = rows.slice(1);

      // Map common invoice CSV headers
      const colMap: Record<string, number> = {};
      const fieldMappings: Record<string, string[]> = {
        invoiceNumber: ["invoice", "invoice #", "invoice number", "invoicenumber", "ticket", "ticket #"],
        customerName: ["customer", "customer name", "name", "client"],
        phone: ["phone", "phone1", "mobile"],
        email: ["email"],
        vehicle: ["vehicle", "car", "year make model"],
        amount: ["total", "amount", "grand total", "invoice total"],
        date: ["date", "invoice date", "created"],
        status: ["status", "payment status"],
        paymentMethod: ["payment", "payment method", "pay method"],
        description: ["services", "description", "line items", "work performed"],
      };

      for (const [field, aliases] of Object.entries(fieldMappings)) {
        for (const alias of aliases) {
          const idx = headers.indexOf(alias);
          if (idx !== -1) {
            colMap[field] = idx;
            break;
          }
        }
      }

      let synced = 0;
      let skipped = 0;

      for (const row of dataRows) {
        try {
          const getValue = (field: string) => {
            const idx = colMap[field];
            return idx !== undefined && idx < row.length ? row[idx] : null;
          };

          const invoiceNumber = getValue("invoiceNumber") || `SD-${Date.now()}-${synced}`;
          const amount = Math.round(parseFloat(getValue("amount") || "0") * 100);
          if (amount <= 0) { skipped++; continue; }

          const existing = await d.select({ id: invoices.id })
            .from(invoices)
            .where(eq(invoices.invoiceNumber, invoiceNumber))
            .limit(1);

          if (existing.length > 0) { skipped++; continue; }

          const pmRaw = (getValue("paymentMethod") || "").toLowerCase();
          const paymentMethod: "cash" | "card" | "check" | "financing" | "other" =
            pmRaw.includes("cash") ? "cash" :
            pmRaw.includes("card") || pmRaw.includes("credit") ? "card" :
            pmRaw.includes("check") ? "check" :
            pmRaw.includes("financ") ? "financing" : "other";

          await d.insert(invoices).values({
            invoiceNumber,
            customerName: getValue("customerName") || "Unknown",
            customerPhone: normalizePhone(getValue("phone") || "") || getValue("phone") || "",
            vehicleInfo: getValue("vehicle") || null,
            totalAmount: amount,
            paymentStatus: (getValue("status") || "").toLowerCase().includes("paid") ? "paid" : "pending",
            paymentMethod,
            source: "shopdriver",
            serviceDescription: getValue("description") || null,
          });
          synced++;
        } catch (err) {
          console.warn("[ShopDriver] Invoice row import skipped:", err instanceof Error ? err.message : err);
          skipped++;
        }
      }

      return { success: true, synced, skipped, total: dataRows.length };
    }),

  // ═══════════════════════════════════════════════════════
  // SETTINGS (existing)
  // ═══════════════════════════════════════════════════════

  /** Get all shop settings */
  getSettings: adminProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      if (input?.category) {
        return d.select().from(shopSettings).where(eq(shopSettings.category, input.category as any));
      }
      return d.select().from(shopSettings);
    }),

  /** Update a shop setting */
  updateSetting: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.string(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };
      await d.update(shopSettings)
        .set({ value: input.value, updatedBy: "admin" })
        .where(eq(shopSettings.key, input.key));
      return { success: true };
    }),

  /** Get the current labor rate */
  getLaborRate: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { laborRate: 115 };
    const result = await d.select().from(shopSettings).where(eq(shopSettings.key, "laborRate")).limit(1);
    return { laborRate: result.length > 0 ? parseFloat(result[0].value) : 115 };
  }),

  /** Get ShopDriver portal URL for quick access */
  portalUrl: adminProcedure.query(() => {
    return {
      url: SD_BASE,
      hasCredentials: !!(process.env.AUTO_LABOR_USERNAME && process.env.AUTO_LABOR_PASSWORD),
    };
  }),
});
