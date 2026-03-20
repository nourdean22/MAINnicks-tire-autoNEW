/**
 * ShopDriver Integration router — CSV import, labor rate sync, shop settings management.
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { customers, shopSettings, customerImportLog } from "../../drizzle/schema";

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

export const shopdriverRouter = router({
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

      // Must have at least first name and phone
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

          // Check if customer already exists (by phone)
          const existing = await d.select({ id: customers.id })
            .from(customers)
            .where(eq(customers.phone, phone))
            .limit(1);

          if (existing.length > 0) {
            // Update existing customer
            await d.update(customers).set({
              firstName,
              lastName,
              email,
              address,
              city,
              state,
              zip,
              phone2,
              customerType,
              totalVisits,
              lastVisitDate: lastVisitDate && !isNaN(lastVisitDate.getTime()) ? lastVisitDate : undefined,
              balanceDue,
              alsCustomerId,
              segment,
            }).where(eq(customers.id, existing[0].id));
            updatedCount++;
          } else {
            // Insert new customer
            await d.insert(customers).values({
              firstName,
              lastName,
              phone,
              phone2,
              email,
              address,
              city,
              state,
              zip,
              customerType,
              totalVisits,
              lastVisitDate: lastVisitDate && !isNaN(lastVisitDate.getTime()) ? lastVisitDate : undefined,
              balanceDue,
              alsCustomerId,
              segment,
            });
            newCount++;
          }
        } catch (e) {
          skippedCount++;
        }
      }

      // Update import log
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

  /** Get the current labor rate (public — used by estimate page) */
  getLaborRate: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { laborRate: 115 };
    const result = await d.select().from(shopSettings).where(eq(shopSettings.key, "laborRate")).limit(1);
    return { laborRate: result.length > 0 ? parseFloat(result[0].value) : 115 };
  }),
});
