/**
 * ShopDriver Full Customer Mirror
 *
 * Authenticates with ShopDriver Elite (secure.autolaborexperts.com),
 * fetches customer list + invoice/ticket history, parses the response,
 * and stores/deduplicates into our DB via Drizzle.
 *
 * Reuses the session pattern from autoLabor.ts.
 * Falls back to HTML scraping if JSON API endpoints aren't available.
 */

import { createLogger } from "../lib/logger";
import { eq } from "drizzle-orm";

const log = createLogger("shopdriver-mirror");

const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";

// ─── SESSION AUTH (mirrors autoLabor.ts pattern) ────────

let mirrorSession: { cookie: string; expiresAt: number } | null = null;

async function getSession(): Promise<string | null> {
  if (mirrorSession && Date.now() < mirrorSession.expiresAt) {
    return mirrorSession.cookie;
  }

  const username = process.env.AUTO_LABOR_USERNAME;
  const password = process.env.AUTO_LABOR_PASSWORD;
  if (!username || !password) {
    log.error("Missing AUTO_LABOR_USERNAME or AUTO_LABOR_PASSWORD");
    return null;
  }

  // Try JSON login first
  try {
    const res = await fetch(`${SHOPDRIVER_BASE}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": SHOPDRIVER_BASE,
        "Referer": `${SHOPDRIVER_BASE}/`,
      },
      body: JSON.stringify({ username, password }),
      redirect: "manual",
    });

    const cookies = res.headers.getSetCookie?.() || [];
    const cookie = cookies.map(c => c.split(";")[0]).join("; ");
    if (cookie) {
      mirrorSession = { cookie, expiresAt: Date.now() + 25 * 60 * 1000 };
      return cookie;
    }
  } catch (err) {
    log.warn("JSON login failed, trying form login", { error: err instanceof Error ? err.message : String(err) });
  }

  // Try form-based login
  try {
    const res = await fetch(`${SHOPDRIVER_BASE}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": SHOPDRIVER_BASE,
        "Referer": `${SHOPDRIVER_BASE}/`,
      },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      redirect: "manual",
    });

    const cookies = res.headers.getSetCookie?.() || [];
    const cookie = cookies.map(c => c.split(";")[0]).join("; ");
    if (cookie) {
      mirrorSession = { cookie, expiresAt: Date.now() + 25 * 60 * 1000 };
      return cookie;
    }
  } catch (err) {
    log.error("Form login also failed", { error: err instanceof Error ? err.message : String(err) });
  }

  return null;
}

// ─── FETCH HELPERS ──────────────────────────────────────

const HEADERS = (cookie: string) => ({
  "Cookie": cookie,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json, text/html, */*",
  "Referer": `${SHOPDRIVER_BASE}/`,
});

interface RawCustomer {
  name: string;
  phone: string;
  phone2?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  vehicles?: string[];
}

interface RawInvoice {
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  date: string;
  service: string;
  vehicleInfo?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  partsCost?: number;
  laborCost?: number;
  taxAmount?: number;
}

/**
 * Try multiple endpoint patterns to fetch customer data.
 * ShopDriver may expose JSON API or server-rendered HTML.
 */
async function fetchCustomers(cookie: string): Promise<RawCustomer[]> {
  const endpoints = [
    "/api/customers",
    "/api/customers?limit=500",
    "/customers",
    "/customer-list",
    "/api/v1/customers",
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${SHOPDRIVER_BASE}${endpoint}`, {
        headers: HEADERS(cookie),
      });

      if (!res.ok) continue;

      const contentType = res.headers.get("content-type") || "";

      // JSON response
      if (contentType.includes("application/json")) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.customers || data.data || data.items || []);
        if (items.length > 0) {
          log.info(`Fetched ${items.length} customers from ${endpoint} (JSON)`);
          return items.map(normalizeCustomerJson);
        }
      }

      // HTML response — parse table rows
      if (contentType.includes("text/html")) {
        const html = await res.text();
        const customers = parseCustomerHtml(html);
        if (customers.length > 0) {
          log.info(`Scraped ${customers.length} customers from ${endpoint} (HTML)`);
          return customers;
        }
      }
    } catch (err) {
      log.warn(`Endpoint ${endpoint} failed`, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  log.warn("No customer data found from any endpoint");
  return [];
}

/**
 * Try multiple endpoint patterns to fetch invoice/ticket data.
 */
async function fetchInvoices(cookie: string): Promise<RawInvoice[]> {
  const endpoints = [
    "/api/invoices",
    "/api/invoices?limit=500",
    "/api/tickets",
    "/api/tickets?limit=500&sort=date_desc",
    "/invoices",
    "/tickets",
    "/recent",
    "/api/v1/invoices",
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${SHOPDRIVER_BASE}${endpoint}`, {
        headers: HEADERS(cookie),
      });

      if (!res.ok) continue;

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.invoices || data.tickets || data.data || data.items || []);
        if (items.length > 0) {
          log.info(`Fetched ${items.length} invoices from ${endpoint} (JSON)`);
          return items.map(normalizeInvoiceJson);
        }
      }

      if (contentType.includes("text/html")) {
        const html = await res.text();
        const invoices = parseInvoiceHtml(html);
        if (invoices.length > 0) {
          log.info(`Scraped ${invoices.length} invoices from ${endpoint} (HTML)`);
          return invoices;
        }
      }
    } catch (err) {
      log.warn(`Endpoint ${endpoint} failed`, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  log.warn("No invoice data found from any endpoint");
  return [];
}

// ─── JSON NORMALIZERS ───────────────────────────────────

function normalizeCustomerJson(raw: any): RawCustomer {
  return {
    name: raw.name || raw.customerName || raw.fullName ||
      [raw.firstName, raw.lastName].filter(Boolean).join(" ") || "Unknown",
    phone: normalizePhone(raw.phone || raw.phoneNumber || raw.mobile || raw.tel || ""),
    phone2: normalizePhone(raw.phone2 || raw.altPhone || raw.workPhone || ""),
    email: raw.email || raw.emailAddress || undefined,
    address: raw.address || raw.streetAddress || raw.addr || undefined,
    city: raw.city || undefined,
    state: raw.state || undefined,
    zip: raw.zip || raw.zipCode || raw.postalCode || undefined,
    vehicles: extractVehicles(raw),
  };
}

function normalizeInvoiceJson(raw: any): RawInvoice {
  const amount = raw.totalAmount || raw.total || raw.amount || raw.grandTotal || 0;
  return {
    invoiceNumber: String(raw.invoiceNumber || raw.ticketNumber || raw.id || raw.ticketId || ""),
    customerName: raw.customerName || raw.customer?.name ||
      [raw.customer?.firstName, raw.customer?.lastName].filter(Boolean).join(" ") || "Unknown",
    customerPhone: normalizePhone(raw.customerPhone || raw.customer?.phone || ""),
    totalAmount: typeof amount === "number" ? Math.round(amount * 100) : parseDollarsToCents(String(amount)),
    date: raw.date || raw.invoiceDate || raw.createdAt || raw.ticketDate || new Date().toISOString(),
    service: raw.serviceDescription || raw.description || raw.service || raw.services?.join(", ") || "",
    vehicleInfo: raw.vehicleInfo || raw.vehicle ||
      [raw.vehicleYear, raw.vehicleMake, raw.vehicleModel].filter(Boolean).join(" ") || undefined,
    paymentMethod: raw.paymentMethod || raw.payType || "other",
    paymentStatus: raw.paymentStatus || raw.status || "paid",
    partsCost: raw.partsCost != null ? Math.round(Number(raw.partsCost) * 100) : 0,
    laborCost: raw.laborCost != null ? Math.round(Number(raw.laborCost) * 100) : 0,
    taxAmount: raw.taxAmount != null ? Math.round(Number(raw.taxAmount) * 100) : 0,
  };
}

function extractVehicles(raw: any): string[] {
  if (Array.isArray(raw.vehicles)) {
    return raw.vehicles.map((v: any) =>
      typeof v === "string" ? v : [v.year, v.make, v.model].filter(Boolean).join(" ")
    );
  }
  if (raw.vehicle) return [typeof raw.vehicle === "string" ? raw.vehicle : [raw.vehicle.year, raw.vehicle.make, raw.vehicle.model].filter(Boolean).join(" ")];
  return [];
}

// ─── HTML SCRAPERS (fallback) ───────────────────────────

function parseCustomerHtml(html: string): RawCustomer[] {
  const customers: RawCustomer[] = [];
  // Match table rows: <tr>...<td>name</td><td>phone</td>...</tr>
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    const rowHtml = rowMatch[1];
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripHtml(cellMatch[1]).trim());
    }

    // Need at least name + phone
    if (cells.length >= 2) {
      const name = cells[0];
      const phone = normalizePhone(cells[1]);
      if (name && phone && phone.length >= 7) {
        customers.push({
          name,
          phone,
          email: cells.find(c => c.includes("@")) || undefined,
          address: cells.length > 3 ? cells[3] : undefined,
          vehicles: cells.length > 4 && cells[4] ? [cells[4]] : [],
        });
      }
    }
  }

  return customers;
}

function parseInvoiceHtml(html: string): RawInvoice[] {
  const invoices: RawInvoice[] = [];

  // ShopDriver /recent page uses nested <table> blocks per ticket.
  // Each block contains: customer name, vehicle, "Invoice# XXXX" or "Estimate# XXXX",
  // date (MM/DD/YYYY), phone, and "Total: $XXX.XX"
  // Split by table blocks and extract from each
  const blocks = html.split(/<table/gi).slice(1); // skip first (header)

  for (const block of blocks) {
    const text = stripHtml(block);

    // Extract invoice/estimate number
    const invoiceMatch = text.match(/Invoice#\s*(\d+)/i);
    const estimateMatch = text.match(/Estimate#\s*(\d+)/i);
    if (!invoiceMatch && !estimateMatch) continue;

    const ticketNum = invoiceMatch ? invoiceMatch[1] : (estimateMatch?.[1] || "");
    const ticketType = invoiceMatch ? "Invoice" : "Estimate";

    // Extract customer name (LASTNAME, FIRSTNAME pattern)
    const nameMatch = text.match(/([A-Z][A-Za-z'\-]+,\s*[A-Z][A-Za-z'\-\s]+)/);
    const customerName = nameMatch ? nameMatch[1].trim() : "";

    // Extract date
    const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
    const date = dateMatch ? dateMatch[1] : "";

    // Extract total amount
    const amountMatch = text.match(/Total:\s*\$([0-9,]+\.\d{2})/i) || text.match(/\$([0-9,]+\.\d{2})/);
    const amount = amountMatch ? parseDollarsToCents(amountMatch[1]) : 0;

    // Extract vehicle
    const vehicleMatch = text.match(/\d{4}\s+[A-Z][A-Za-z\s\*\-]+/);
    const vehicle = vehicleMatch ? vehicleMatch[0].trim() : "";

    // Extract phone
    const phoneMatch = text.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
    const phone = phoneMatch ? `${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}` : "";

    if (customerName || ticketNum) {
      invoices.push({
        invoiceNumber: `${ticketType}# ${ticketNum}`,
        customerName,
        customerPhone: phone,
        totalAmount: amount,
        date,
        service: `${ticketType} - ${vehicle}`,
        vehicleInfo: vehicle || undefined,
        paymentStatus: ticketType === "Invoice" ? "paid" : "pending",
      });
    }
  }

  return invoices;
}

// ─── UTILS ──────────────────────────────────────────────

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits;
}

function parseDollarsToCents(str: string): number {
  const cleaned = str.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

// ─── DB STORAGE (Drizzle) ───────────────────────────────

async function getDb() {
  const { getDb: _getDb } = await import("../db");
  return _getDb();
}

async function upsertCustomers(rawCustomers: RawCustomer[]): Promise<{ created: number; updated: number }> {
  const d = await getDb();
  if (!d) return { created: 0, updated: 0 };

  const { customers } = await import("../../drizzle/schema");
  let created = 0;
  let updated = 0;

  for (const rc of rawCustomers) {
    if (!rc.phone || rc.phone.length < 7) continue;

    try {
      // Deduplicate by phone
      const existing = await d.select().from(customers).where(eq(customers.phone, rc.phone)).limit(1);

      const nameParts = rc.name.split(/\s+/);
      const firstName = nameParts[0] || "Unknown";
      const lastName = nameParts.slice(1).join(" ") || undefined;

      if (existing.length > 0) {
        // Update existing — only fill in blanks, don't overwrite
        const updates: Record<string, any> = {};
        const ex = existing[0];
        if (!ex.email && rc.email) updates.email = rc.email;
        if (!ex.address && rc.address) updates.address = rc.address;
        if (!ex.city && rc.city) updates.city = rc.city;
        if (!ex.state && rc.state) updates.state = rc.state;
        if (!ex.zip && rc.zip) updates.zip = rc.zip;
        if (!ex.phone2 && rc.phone2) updates.phone2 = rc.phone2;

        if (Object.keys(updates).length > 0) {
          await d.update(customers).set(updates).where(eq(customers.id, ex.id));
          updated++;
        }
      } else {
        await d.insert(customers).values({
          firstName,
          lastName,
          phone: rc.phone,
          phone2: rc.phone2 || undefined,
          email: rc.email || undefined,
          address: rc.address || undefined,
          city: rc.city || undefined,
          state: rc.state || undefined,
          zip: rc.zip || undefined,
          segment: "unknown",
        });
        created++;
      }
    } catch (err) {
      log.warn(`Failed to upsert customer ${rc.name}/${rc.phone}`, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { created, updated };
}

async function upsertInvoices(rawInvoices: RawInvoice[]): Promise<{ created: number; skipped: number }> {
  const d = await getDb();
  if (!d) return { created: 0, skipped: 0 };

  const { invoices, customers } = await import("../../drizzle/schema");
  let created = 0;
  let skipped = 0;

  for (const ri of rawInvoices) {
    if (!ri.invoiceNumber) { skipped++; continue; }

    try {
      // Skip if invoice already exists
      const existing = await d.select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.invoiceNumber, ri.invoiceNumber))
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // Try to match customer by phone for linking
      let customerId: number | undefined;
      if (ri.customerPhone) {
        const phone = normalizePhone(ri.customerPhone);
        if (phone.length >= 7) {
          const match = await d.select({ id: customers.id })
            .from(customers)
            .where(eq(customers.phone, phone))
            .limit(1);
          if (match.length > 0) customerId = match[0].id;
        }
      }

      // Normalize payment method
      const paymentMethod = normalizePaymentMethod(ri.paymentMethod);
      const paymentStatus = normalizePaymentStatus(ri.paymentStatus);

      await d.insert(invoices).values({
        customerId: customerId ?? null,
        customerName: ri.customerName,
        customerPhone: ri.customerPhone || null,
        invoiceNumber: ri.invoiceNumber,
        totalAmount: ri.totalAmount,
        partsCost: ri.partsCost || 0,
        laborCost: ri.laborCost || 0,
        taxAmount: ri.taxAmount || 0,
        serviceDescription: ri.service || null,
        vehicleInfo: ri.vehicleInfo || null,
        paymentMethod,
        paymentStatus,
        invoiceDate: new Date(ri.date),
        source: "shopdriver",
      });
      created++;
    } catch (err) {
      log.warn(`Failed to upsert invoice ${ri.invoiceNumber}`, { error: err instanceof Error ? err.message : String(err) });
      skipped++;
    }
  }

  return { created, skipped };
}

function normalizePaymentMethod(raw?: string): "cash" | "card" | "check" | "financing" | "other" {
  if (!raw) return "other";
  const lower = raw.toLowerCase();
  if (lower.includes("cash")) return "cash";
  if (lower.includes("card") || lower.includes("credit") || lower.includes("debit") || lower.includes("visa") || lower.includes("master")) return "card";
  if (lower.includes("check") || lower.includes("cheque")) return "check";
  if (lower.includes("financ") || lower.includes("acima") || lower.includes("snap") || lower.includes("koalafi")) return "financing";
  return "other";
}

function normalizePaymentStatus(raw?: string): "paid" | "pending" | "partial" | "refunded" {
  if (!raw) return "paid";
  const lower = raw.toLowerCase();
  if (lower.includes("paid") || lower.includes("complete") || lower.includes("closed")) return "paid";
  if (lower.includes("pending") || lower.includes("open") || lower.includes("unpaid")) return "pending";
  if (lower.includes("partial")) return "partial";
  if (lower.includes("refund") || lower.includes("void")) return "refunded";
  return "paid";
}

// ─── MAIN SYNC FUNCTION ─────────────────────────────────

/**
 * Full mirror sync: authenticate, fetch customers + invoices,
 * parse, deduplicate, and store in our DB.
 */
export async function runFullMirror(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const start = Date.now();
  log.info("Starting full ShopDriver mirror sync");

  const cookie = await getSession();
  if (!cookie) {
    log.error("Could not authenticate with ShopDriver — mirror aborted");
    return { recordsProcessed: 0, details: "Auth failed — no credentials or login rejected" };
  }

  // Fetch in parallel
  const [rawCustomers, rawInvoices] = await Promise.all([
    fetchCustomers(cookie),
    fetchInvoices(cookie),
  ]);

  // Store customers first (so invoice linking works)
  const custResult = await upsertCustomers(rawCustomers);
  const invResult = await upsertInvoices(rawInvoices);

  const duration = Date.now() - start;
  const total = custResult.created + custResult.updated + invResult.created;

  const details = [
    `Customers: ${custResult.created} new, ${custResult.updated} updated (${rawCustomers.length} fetched)`,
    `Invoices: ${invResult.created} new, ${invResult.skipped} skipped (${rawInvoices.length} fetched)`,
    `Duration: ${duration}ms`,
  ].join(" | ");

  log.info(`Mirror complete: ${details}`);

  return { recordsProcessed: total, details };
}
