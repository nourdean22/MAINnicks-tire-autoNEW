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
import { db } from "../lib/db-helper";
import { normalizePhone } from "../lib/phone";
import { getAdminActivity } from "../lib/adminActivity";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:shopdriver");
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
let sdLastProbeAt = 0;
let sdLoginInFlight: Promise<boolean> | null = null;

/** Detect when ShopDriver has kicked the session (login page / HTML / auth error). */
function isSessionKicked(res: Response, bodyPreview: string): boolean {
  if (res.status === 401 || res.status === 403) return true;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) return true;
  const trimmed = bodyPreview.trimStart().toLowerCase();
  if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || trimmed.startsWith("<")) return true;
  if (trimmed.includes("<html") || trimmed.includes("login") && trimmed.includes("password")) return true;
  return false;
}

async function sdLogin(): Promise<boolean> {
  // Single-flight: coalesce concurrent logins so we don't stampede the auth endpoint.
  if (sdLoginInFlight) return sdLoginInFlight;

  sdLoginInFlight = (async () => {
    const username = process.env.AUTO_LABOR_USERNAME || process.env.ALG_USERNAME;
    const password = process.env.AUTO_LABOR_PASSWORD || process.env.ALG_PASSWORD;
    if (!username || !password) {
      log.error("[ShopDriver] Missing credentials: AUTO_LABOR_USERNAME / AUTO_LABOR_PASSWORD");
      return false;
    }

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
        sdLastProbeAt = Date.now();
        console.info("[ShopDriver] Logged in successfully (cookie auth)");
        return true;
      }

      // Some systems return a token in the body
      if (res.ok) {
        try {
          const body = await res.json();
          if (body.token || body.session) {
            sdSessionCookie = `token=${body.token || body.session}`;
            sdSessionExpiry = Date.now() + 30 * 60 * 1000;
            sdLastProbeAt = Date.now();
            console.info("[ShopDriver] Logged in successfully (token auth)");
            return true;
          }
        } catch (e) { /* response not JSON — expected for some auth flows */ log.warn("[routers/shopdriver] operation failed:", e); }
      }

      log.error("[ShopDriver] Login returned no session cookie or token, status:", res.status);
      return false;
    } catch (err) {
      log.error("[ShopDriver] Login failed:", err instanceof Error ? err.message : err);
      return false;
    }
  })();

  try {
    return await sdLoginInFlight;
  } finally {
    sdLoginInFlight = null;
  }
}

/** Invalidate the cached session so the next call forces a fresh login. */
function sdInvalidateSession() {
  sdSessionCookie = null;
  sdSessionExpiry = 0;
}

/**
 * Core fetch with auto-reauth:
 *   1. Ensure we have a cookie (login if missing/expired)
 *   2. Fire request
 *   3. If response is HTML / 401 / 403 → session was kicked
 *   4. Invalidate + re-login + retry ONCE
 */
async function sdFetch(path: string): Promise<Response | null> {
  // Ensure session (respects local expiry)
  if (!sdSessionCookie || Date.now() > sdSessionExpiry) {
    const ok = await sdLogin();
    if (!ok) return null;
  }

  const doFetch = async (): Promise<Response | null> => {
    try {
      return await fetch(`${SD_BASE}${path}`, {
        headers: {
          Cookie: sdSessionCookie || "",
          Accept: "application/json",
        },
      });
    } catch (err) {
      log.error("[ShopDriver] Fetch failed:", err instanceof Error ? err.message : err);
      return null;
    }
  };

  // First attempt
  let res = await doFetch();
  if (!res) return null;

  // Peek at body WITHOUT consuming it, so downstream can still read it
  const clone = res.clone();
  let bodyPreview = "";
  try {
    bodyPreview = (await clone.text()).substring(0, 500);
  } catch { /* ignore */ }

  if (isSessionKicked(res, bodyPreview)) {
    log.warn(`[ShopDriver] Session kicked on ${path} (status ${res.status}, preview: ${bodyPreview.substring(0, 80)}) — forcing re-login`);
    sdInvalidateSession();
    const ok = await sdLogin();
    if (!ok) return res; // re-login failed, return the HTML response so caller reports it

    // Retry once with fresh cookie
    res = await doFetch();
    if (!res) return null;

    // If STILL kicked after fresh login, give up and return what we got
    const clone2 = res.clone();
    let preview2 = "";
    try { preview2 = (await clone2.text()).substring(0, 500); } catch { /* ignore */ }
    if (isSessionKicked(res, preview2)) {
      log.error(`[ShopDriver] Still kicked after re-login on ${path} — credentials may be wrong or API changed`);
    }
  }

  // Passive liveness: if we haven't probed in 2 min, record this successful call as a heartbeat
  if (res.ok && !isSessionKicked(res, bodyPreview)) {
    sdLastProbeAt = Date.now();
  }

  return res;
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
  // SHOP-PROTECT STATUS — tells admin UI whether probes are running
  // ═══════════════════════════════════════════════════════

  /**
   * Returns the shop-protection state. When Nour is on /admin, probes run.
   * When Nour is away, probes skip so the shop counter's ShopDriver session
   * stays alive (probes auth against ShopDriver which kicks the shop login).
   */
  shopProtectStatus: adminProcedure.query(async () => {
    const activity = getAdminActivity();
    return {
      ...activity,
      probesEnabled: activity.active,
      explanation: activity.active
        ? "Probes running. Admin session active — ShopDriver/ALG sync will run on schedule."
        : "Probes paused. No admin activity in the last 10 min. The shop counter is protected from session kicks. Open /admin to resume syncs, or trigger a manual sync below.",
    };
  }),

  /**
   * Manually force a ShopDriver full-mirror run, bypassing the admin-activity
   * gate. Use when Nour needs fresh data and understands this will kick the
   * shop counter out of ShopDriver.
   */
  forceSyncNow: adminProcedure.mutation(async ({ ctx }) => {
    const { runFullMirror } = await import("../services/shopDriverMirror");
    const result = await runFullMirror();

    const { logAdminAction } = await import("../services/auditTrail");
    logAdminAction({
      action: "shopdriver.force_sync",
      entityType: "system",
      entityId: 0,
      details: "Manual full-mirror sync triggered — ShopDriver credentials session refreshed.",
      actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
    }).catch(() => {});

    return { ...result, note: "Manual full-mirror run — shop counter session may have been kicked." };
  }),

  // ═══════════════════════════════════════════════════════
  // 2026-05-05 — DEMAND-DRIVEN PROBE BUDGET
  // ═══════════════════════════════════════════════════════

  /**
   * Request an ALG probe from the demand-driven budget. This is the
   * CORRECT way to refresh ALG data — it dedups within 30s, skips when
   * data is fresh (<5 min), and writes a row to alg_probe_log.
   *
   * Use this from the admin "Refresh from ALG" button. Use forceSyncNow
   * only when you absolutely need to override (and accept the shop kick).
   */
  requestProbe: adminProcedure
    .input(z.object({
      reason: z.enum(["manual_refresh", "chat_query", "admin_login", "overnight", "health_check"]).default("manual_refresh"),
      detail: z.string().max(200).optional(),
      force: z.boolean().default(false),
    }).optional())
    .mutation(async ({ input, ctx }) => {
      const { requestAlgProbe } = await import("../services/algProbeBudget");
      const res = await requestAlgProbe(input?.reason ?? "manual_refresh", {
        detail: input?.detail,
        force: input?.force,
      });

      if ((input?.reason ?? "manual_refresh") === "manual_refresh") {
        const { logAdminAction } = await import("../services/auditTrail");
        logAdminAction({
          action: "shopdriver.manual_probe",
          entityType: "system",
          entityId: 0,
          details: `Manual live API probe requested: ${input?.detail ?? "No details provided"} (force: ${input?.force ?? false})`,
          actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
        }).catch(() => {});
      }

      return res;
    }),

  /**
   * Read the last N probe attempts. For the admin "Probe Log" panel —
   * shows when each probe fired, why, and what came back.
   */
  recentProbes: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const { getRecentProbes, getProbeBudgetState } = await import("../services/algProbeBudget");
      const [probes, state] = await Promise.all([
        getRecentProbes(input?.limit ?? 20),
        Promise.resolve(getProbeBudgetState()),
      ]);
      return { probes, state };
    }),

  /**
   * Probe estimate endpoints — returns what each candidate URL responds
   * with so we can figure out which one Moe's ShopDriver tenant exposes.
   * Doesn't upsert; observation only.
   *
   * Use case: alg_estimates is empty in production. We need to know
   * which endpoint actually works on Moe's tenant. Run this once, find
   * the working endpoint, hardcode it as the first probe candidate.
   */
  probeEstimateEndpoints: adminProcedure.mutation(async () => {
    const { probeEstimateEndpoints } = await import("../services/shopDriverEstimateSync");
    const results = await probeEstimateEndpoints();
    return {
      total: results.length,
      working: results.filter((r) => r.status === 200 && r.contentType.includes("json") && (r.itemCount ?? 0) > 0).length,
      results,
    };
  }),

  /**
   * Status of declined-work recovery feature. Shows whether the
   * FEATURE_DECLINED_RECOVERY env flag is set + how many estimates are
   * eligible for follow-up + total recoverable $.
   */
  declinedRecoveryStatus: adminProcedure.query(async () => {
    const featureEnabled = process.env.FEATURE_DECLINED_RECOVERY === "1";
    const d = await db();
    if (!d) {
      return { featureEnabled, eligible: 0, recoverableDollars: 0, dryRun: !featureEnabled };
    }
    try {
      const { algEstimates } = await import("../../drizzle/schema");
      const { isNull, gte, sql, lte } = await import("drizzle-orm");
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const rows = await d
        .select({
          id: algEstimates.id,
          estimatedAmount: algEstimates.estimatedAmount,
          followUp7dSent: algEstimates.followUp7dSent,
          followUp30dSent: algEstimates.followUp30dSent,
          estimateDate: algEstimates.estimateDate,
        })
        .from(algEstimates)
        .where(sql`${algEstimates.matchedInvoiceId} IS NULL AND ${algEstimates.estimateDate} >= ${sixtyDaysAgo} AND ${algEstimates.estimateDate} <= ${sevenDaysAgo}`)
        .limit(500);
      const totalCents = rows.reduce((s: number, r: { estimatedAmount: number | null }) => s + (r.estimatedAmount || 0), 0);
      return {
        featureEnabled,
        dryRun: !featureEnabled,
        eligible: rows.length,
        recoverableDollars: Math.round(totalCents / 100),
        next7dSends: rows.filter((r: { followUp7dSent: number }) => r.followUp7dSent === 0).length,
        next30dSends: rows.filter((r: { followUp30dSent: number }) => r.followUp30dSent === 0).length,
        message: featureEnabled
          ? "Live: 7-day + 30-day SMS follow-ups firing daily during business hours."
          : "DRY RUN: Set FEATURE_DECLINED_RECOVERY=1 in Railway env to enable SMS sends.",
      };
    } catch (err) {
      log.warn("[shopdriver] declinedRecoveryStatus failed:", err instanceof Error ? err.message : err);
      return { featureEnabled, eligible: 0, recoverableDollars: 0, dryRun: !featureEnabled, error: "DB query failed" };
    }
  }),

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
          const totalVisits = parseInt(getValue("totalVisits") || "0", 10) || 0;
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
            // wave-116 — was a bare INSERT vulnerable to a race: two
            // concurrent imports both miss the SELECT, both INSERT,
            // duplicate created. After migration 0034 adds UNIQUE on
            // phone, the second INSERT throws ER_DUP_ENTRY; catch it
            // and fall through to UPDATE so the row isn't lost.
            // Pre-migration this code path is unchanged.
            try {
              await d.insert(customers).values({
                firstName, lastName, phone, phone2, email, address, city, state, zip,
                customerType, totalVisits,
                lastVisitDate: lastVisitDate && !isNaN(lastVisitDate.getTime()) ? lastVisitDate : undefined,
                balanceDue, alsCustomerId, segment,
              });
              newCount++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (/Duplicate entry|ER_DUP_ENTRY/i.test(msg)) {
                // Race lost — another writer created this customer between
                // our SELECT and INSERT. Update the existing row with the
                // fresh fields so we don't lose the operator's data.
                await d.update(customers).set({
                  firstName, lastName, email, address, city, state, zip,
                  phone2, customerType, totalVisits,
                  lastVisitDate: lastVisitDate && !isNaN(lastVisitDate.getTime()) ? lastVisitDate : undefined,
                  balanceDue, alsCustomerId, segment,
                }).where(eq(customers.phone, phone));
                updatedCount++;
                log.warn("[ShopDriver] Customer race detected — converted INSERT to UPDATE", { phone });
              } else {
                throw err;
              }
            }
          }
        } catch (err) {
          log.warn("[ShopDriver] Customer import row skipped:", err instanceof Error ? err.message : err);
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
      const bodyText = await res.text();

      // Check if response is HTML instead of JSON (expired session / login page)
      if (bodyText.trimStart().startsWith("<") || bodyText.includes("<html")) {
        log.error("[ShopDriver] Invoice sync got HTML response:", bodyText.substring(0, 200));
        return { success: false, error: "ShopDriver returned HTML instead of JSON — the API session may have expired", synced: 0 };
      }

      let data: any;
      try {
        data = JSON.parse(bodyText);
      } catch (e) {
        log.warn("[routers/shopdriver] operation failed:", e);
        log.error("[ShopDriver] Invoice sync non-JSON response:", bodyText.substring(0, 200));
        return { success: false, error: "ShopDriver returned non-JSON response — check API credentials", synced: 0 };
      }

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

          // wave-116c — race-safe insert (invoices.invoiceNumber is UNIQUE
          // in schema). Two concurrent imports both miss the SELECT, both
          // INSERT, second one fails with Duplicate-entry — convert to
          // UPDATE so the latest data wins, no row is lost.
          try {
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
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/Duplicate entry|ER_DUP_ENTRY/i.test(msg)) {
              await d.update(invoices).set({
                totalAmount: amount,
                paymentStatus: ticket.status === "paid" || ticket.paid ? "paid" : "pending",
                serviceDescription: services || undefined,
              }).where(eq(invoices.invoiceNumber, invoiceNumber));
              updated++;
              log.warn("[ShopDriver] Invoice race detected — INSERT → UPDATE", { invoiceNumber });
            } else {
              throw err;
            }
          }
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
      log.error("[ShopDriver] Invoice sync failed:", err instanceof Error ? err.message : err);
      return { success: false, error: `Failed to sync invoices: ${err instanceof Error ? err.message : "Unknown error"}`, synced: 0 };
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
      const bodyText = await res.text();

      // Check if response is HTML instead of JSON (expired session / login page)
      if (bodyText.trimStart().startsWith("<") || bodyText.includes("<html")) {
        log.error("[ShopDriver] Customer sync got HTML response:", bodyText.substring(0, 200));
        return { success: false, error: "ShopDriver returned HTML instead of JSON — the API session may have expired", synced: 0 };
      }

      let data: any;
      try {
        data = JSON.parse(bodyText);
      } catch (e) {
        log.warn("[routers/shopdriver] operation failed:", e);
        log.error("[ShopDriver] Customer sync non-JSON response:", bodyText.substring(0, 200));
        return { success: false, error: "ShopDriver returned non-JSON response — check API credentials", synced: 0 };
      }

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
          // wave-116 — race-safe insert (see comment at line ~488 above
          // for full rationale). Catches Duplicate-entry post-migration
          // and converts to UPDATE.
          try {
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
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/Duplicate entry|ER_DUP_ENTRY/i.test(msg)) {
              await d.update(customers).set({
                firstName, lastName,
                email: cust.email || undefined,
                address: cust.address || cust.street || undefined,
                city: cust.city || undefined,
                state: cust.state || undefined,
                zip: cust.zip || cust.zipCode || undefined,
                alsCustomerId: String(cust.id || cust.customerId || ""),
              }).where(eq(customers.phone, phone));
              updatedCount++;
              log.warn("[ShopDriver] Customer race detected — converted INSERT to UPDATE", { phone });
            } else {
              throw err;
            }
          }
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
      log.error("[ShopDriver] Customer sync failed:", err instanceof Error ? err.message : err);
      return { success: false, error: `Failed to sync customers: ${err instanceof Error ? err.message : "Unknown error"}`, synced: 0 };
    }
  }),

  /** Get sync status and history */
  syncStatus: adminProcedure.query(async () => {
    const d = await db();
    const customerCount = d ? await d.select({ count: sql<number>`count(*)` }).from(customers) : [{ count: 0 }];
    const invoiceCount = d ? await d.select({ count: sql<number>`count(*)` }).from(invoices) : [{ count: 0 }];
    const bookingCount = d ? await d.select({ count: sql<number>`count(*)` }).from(bookings) : [{ count: 0 }];

    return {
      connected: !!(process.env.AUTO_LABOR_USERNAME || process.env.ALG_USERNAME),
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
          log.warn("[ShopDriver] Invoice row import skipped:", err instanceof Error ? err.message : err);
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

  /** Upsert a shop setting (create if not exists, update if exists) */
  upsertSetting: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.string(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };
      const existing = await d.select().from(shopSettings).where(eq(shopSettings.key, input.key)).limit(1);
      if (existing.length > 0) {
        await d.update(shopSettings)
          .set({ value: input.value, updatedBy: "admin" })
          .where(eq(shopSettings.key, input.key));
      } else {
        await d.insert(shopSettings).values({
          key: input.key,
          value: input.value,
          updatedBy: "admin",
        });
      }
      return { success: true };
    }),

  /** Get a single shop setting by key */
  getSetting: adminProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return null;
      const result = await d.select().from(shopSettings).where(eq(shopSettings.key, input.key)).limit(1);
      return result.length > 0 ? result[0] : null;
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
      hasCredentials: !!((process.env.AUTO_LABOR_USERNAME || process.env.ALG_USERNAME) && (process.env.AUTO_LABOR_PASSWORD || process.env.ALG_PASSWORD)),
    };
  }),
});
