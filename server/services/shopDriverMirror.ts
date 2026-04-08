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
import { eq, and } from "drizzle-orm";

const log = createLogger("shopdriver-mirror");

// Frontend SPA shell (for reference only)
const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";
// Actual API backend — GUID subdomain discovered from SPA network calls
const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";

// ─── FAILURE TRACKING ──────────────────────────────────
// Track consecutive failures so we can escalate alerts
let consecutiveFailures = 0;
let lastSuccessfulSync: Date | null = null;
let lastAlertSent: Date | null = null;
const ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // Don't spam — max 1 alert every 2 hours

// ─── SESSION AUTH ──────────────────────────────────────
// ShopDriver uses JWT token auth via a GUID-subdomain API.
// The SPA at secure.autolaborexperts.com calls the GUID API for all data.
// When someone logs in at the shop computer, it MAY invalidate our token.
// TTL extended to 30 min to reduce re-auth frequency and avoid session conflicts.
// lastAuthAt guard prevents re-auth within 25 min even if token is stale.

let mirrorSession: { token: string; expiresAt: number } | null = null;
let lastMirrorAuthAt = 0;

/** Force-clear the cached session */
function invalidateSession() {
  mirrorSession = null;
}

/**
 * Detect if an API response means our token is dead.
 * ShopDriver API returns 401/403 for expired tokens.
 */
function isSessionKicked(res: Response, body?: string): boolean {
  // 401/403 = token expired or invalidated
  if (res.status === 401 || res.status === 403) return true;
  // Redirect to login page (shouldn't happen with API calls but check anyway)
  const location = res.headers.get("location") || "";
  if (location.includes("/login") || location.includes("/signin")) return true;
  // HTML body contains login form = we got the SPA shell instead of data
  if (body && (
    body.includes('name="password"') ||
    body.includes('id="login-form"') ||
    body.includes('action="/login"') ||
    (body.includes("Sign In") && body.includes("Password") && !body.includes("Invoice"))
  )) return true;
  return false;
}

async function getSession(): Promise<string | null> {
  // Reuse token within its TTL window
  if (mirrorSession && Date.now() < mirrorSession.expiresAt) {
    return mirrorSession.token;
  }

  // Don't re-authenticate if we already authed within 25 minutes — prevents
  // kicking the physical shop's browser session with rapid re-logins
  const AUTH_COOLDOWN = 25 * 60 * 1000;
  if (mirrorSession && (Date.now() - lastMirrorAuthAt) < AUTH_COOLDOWN) {
    return mirrorSession.token;
  }

  const username = process.env.AUTO_LABOR_USERNAME || process.env.ALG_USERNAME;
  const password = process.env.AUTO_LABOR_PASSWORD || process.env.ALG_PASSWORD;
  if (!username || !password) {
    log.error("Missing AUTO_LABOR_USERNAME/PASSWORD or ALG_USERNAME/PASSWORD");
    return null;
  }

  // ShopDriver API uses /api/account/login with {login, password} fields
  // Returns a JWT token in the response body (not cookies)
  try {
    const res = await fetch(`${SHOPDRIVER_API}/api/account/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": SHOPDRIVER_BASE,
        "Referer": `${SHOPDRIVER_BASE}/`,
      },
      body: JSON.stringify({
        login: username,     // Field is "login" not "username"
        password,
        ipAddress: "",
        location: "",
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      log.error(`Login failed: HTTP ${res.status}`, { body: errBody.substring(0, 300) });
      return null;
    }

    const data = await res.json();
    log.info("Login response keys", { keys: Object.keys(data), hasToken: !!data.token, hasJwt: !!data.jwt, hasAccessToken: !!data.accessToken, hasData: !!data.data });

    // Extract JWT — try common response shapes
    const token = data.token || data.jwt || data.accessToken || data.access_token ||
      data.data?.token || data.data?.jwt || data.data?.accessToken ||
      data.result?.token || data.result?.jwt;

    if (token && typeof token === "string") {
      mirrorSession = { token, expiresAt: Date.now() + 30 * 60 * 1000 }; // 30 min TTL
      lastMirrorAuthAt = Date.now();
      log.info("Authenticated via JWT token");
      return token;
    }

    // If no obvious token field, check if the response IS the token (raw string)
    if (typeof data === "string" && data.length > 20) {
      mirrorSession = { token: data, expiresAt: Date.now() + 30 * 60 * 1000 }; // 30 min TTL
      lastMirrorAuthAt = Date.now();
      log.info("Authenticated — raw token response");
      return data;
    }

    // Also check for cookies as fallback (some APIs set both)
    const cookies = res.headers.getSetCookie?.() || [];
    const cookie = cookies.map(c => c.split(";")[0]).join("; ");
    if (cookie) {
      mirrorSession = { token: `cookie:${cookie}`, expiresAt: Date.now() + 30 * 60 * 1000 }; // 30 min TTL
      lastMirrorAuthAt = Date.now();
      log.info("Authenticated via cookie fallback");
      return `cookie:${cookie}`;
    }

    // Log full response for debugging if we can't find the token
    log.error("Login succeeded but couldn't extract token", { response: JSON.stringify(data).substring(0, 500) });
    return null;
  } catch (err) {
    log.error("API login failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ─── FETCH HELPERS ──────────────────────────────────────

/** Build headers for authenticated API requests. Handles both JWT and cookie auth. */
const HEADERS = (token: string): Record<string, string> => {
  const base: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/html, */*",
    "Referer": `${SHOPDRIVER_BASE}/`,
  };
  // If token starts with "cookie:" it's a cookie fallback
  if (token.startsWith("cookie:")) {
    base["Cookie"] = token.slice(7);
  } else {
    base["Authorization"] = `Bearer ${token}`;
  }
  return base;
};

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
 * ShopDriver API uses ASP.NET-style /api/{Controller}/{Action} routes
 * on the GUID subdomain. Detects expired tokens.
 */
async function fetchCustomers(token: string): Promise<RawCustomer[]> {
  // Real endpoints discovered from SPA bundle (axios baseURL = /api)
  // API uses pageNumber + pageSize query params for pagination
  const endpoints = [
    "/api/Customer/listCustomers?pageNumber=1&pageSize=500",
    "/api/Search/getCustomerSearch?pageNumber=1&pageSize=500",
    "/api/Customer/potentialMatches?pageNumber=1&pageSize=500",
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${SHOPDRIVER_API}${endpoint}`, {
        headers: HEADERS(token),
        signal: AbortSignal.timeout(30000),
      });

      // Log every attempt for endpoint discovery
      log.info(`Customer endpoint probe: ${endpoint} → ${res.status} ${res.headers.get("content-type") || "no-type"}`);

      // Detect expired token
      if (isSessionKicked(res)) {
        log.warn(`Token expired on ${endpoint}`);
        invalidateSession();
        return [];
      }

      if (!res.ok) continue;

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const data = await res.json();
        // Handle various response shapes
        const items = Array.isArray(data) ? data
          : (data.customers || data.data || data.items || data.result || data.results || []);
        const list = Array.isArray(items) ? items : [];
        if (list.length > 0) {
          log.info(`Fetched ${list.length} customers from ${endpoint} (JSON)`);
          return list.map(normalizeCustomerJson);
        }
        // Log empty but valid responses for debugging
        log.info(`${endpoint} returned JSON but 0 items`, { keys: Object.keys(data), type: typeof data });
      }

      // HTML fallback — parse table rows
      if (contentType.includes("text/html")) {
        const html = await res.text();
        if (isSessionKicked(res, html)) {
          log.warn(`Login page returned on ${endpoint} — token was invalid`);
          invalidateSession();
          return [];
        }
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
 * ShopDriver API uses ASP.NET-style /api/{Controller}/{Action} routes.
 * The SPA shows "Recent Tickets" after login, so tickets are the primary entity.
 */
async function fetchInvoices(token: string): Promise<RawInvoice[]> {
  // Real endpoints discovered from SPA bundle (axios baseURL = /api)
  // API uses pageNumber + pageSize query params for pagination
  const endpoints = [
    "/api/ticket/listRecentTickets?pageNumber=1&pageSize=500",
    "/api/ticket/listTicketSessions?pageNumber=1&pageSize=500",
    "/api/Report/listTotalSales?pageNumber=1&pageSize=500",
    "/api/Search/getTicketSearch?pageNumber=1&pageSize=500",
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${SHOPDRIVER_API}${endpoint}`, {
        headers: HEADERS(token),
        signal: AbortSignal.timeout(30000),
      });

      // Log every attempt for endpoint discovery
      log.info(`Invoice endpoint probe: ${endpoint} → ${res.status} ${res.headers.get("content-type") || "no-type"}`);

      // Detect expired token
      if (isSessionKicked(res)) {
        log.warn(`Token expired on ${endpoint}`);
        invalidateSession();
        return [];
      }

      if (!res.ok) continue;

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const data = await res.json();
        // Handle various response shapes
        const items = Array.isArray(data) ? data
          : (data.invoices || data.tickets || data.data || data.items || data.result || data.results || []);
        const list = Array.isArray(items) ? items : [];
        if (list.length > 0) {
          log.info(`Fetched ${list.length} invoices from ${endpoint} (JSON)`, {
            sampleKeys: list[0] ? Object.keys(list[0]).slice(0, 15) : [],
          });
          return list.map(normalizeInvoiceJson);
        }
        // Log empty but valid responses for debugging
        log.info(`${endpoint} returned JSON but 0 items`, { keys: Object.keys(data), type: typeof data });
      }

      // HTML fallback — parse table rows (for /recent page on SPA base)
      if (contentType.includes("text/html")) {
        const html = await res.text();
        if (isSessionKicked(res, html)) {
          log.warn(`Login page returned on ${endpoint} — token was invalid`);
          invalidateSession();
          return [];
        }
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

  // Last resort: try scraping the SPA /recent page (it renders tickets client-side)
  // This won't work with token auth but try with cookie fallback
  try {
    const res = await fetch(`${SHOPDRIVER_BASE}/recent`, {
      headers: HEADERS(token),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const html = await res.text();
      if (!isSessionKicked(res, html)) {
        const invoices = parseInvoiceHtml(html);
        if (invoices.length > 0) {
          log.info(`Scraped ${invoices.length} invoices from SPA /recent (HTML)`);
          return invoices;
        }
      }
    }
  } catch (e) { console.warn("[shopDriverMirror:fetchInvoices] SPA /recent scrape failed:", e); }

  log.warn("No invoice data found from any endpoint");
  return [];
}

// ─── JSON NORMALIZERS ───────────────────────────────────

function normalizeCustomerJson(raw: any): RawCustomer {
  return {
    name: raw.name || raw.customerName || raw.fullName ||
      [raw.firstName, raw.lastName].filter(Boolean).join(" ") || "Unknown",
    phone: normalizePhone(raw.primaryPhone || raw.primaryNumber || raw.phone || raw.phoneNumber || raw.mobile || ""),
    phone2: normalizePhone(raw.secondaryPhone || raw.phone2 || raw.altPhone || ""),
    email: raw.email || raw.emailAddress || undefined,
    address: raw.addressLine1 || raw.address || raw.streetAddress || undefined,
    city: raw.city || undefined,
    state: raw.state || undefined,
    zip: raw.postalCode || raw.zip || raw.zipCode || undefined,
    vehicles: extractVehicles(raw),
  };
}

function normalizeInvoiceJson(raw: any): RawInvoice {
  const amount = raw.totalAmount || raw.total || raw.amount || raw.grandTotal || 0;
  return {
    invoiceNumber: String(raw.invoiceNumber || raw.ticketNumber || raw.ticketId || raw.id || ""),
    customerName: raw.customerName || raw.customer?.name ||
      [raw.firstName, raw.lastName].filter(Boolean).join(" ") ||
      [raw.customer?.firstName, raw.customer?.lastName].filter(Boolean).join(" ") || "Unknown",
    customerPhone: normalizePhone(raw.primaryNumber || raw.primaryPhone || raw.customerPhone || raw.customer?.phone || ""),
    totalAmount: typeof amount === "number" ? Math.round(amount * 100) : parseDollarsToCents(String(amount)),
    date: raw.date || raw.invoiceDate || raw.createdAt || raw.ticketDate || raw.accessedDate || new Date().toISOString(),
    service: raw.serviceDescription || raw.description || raw.service || raw.vehicleDescription || raw.services?.join(", ") || "",
    vehicleInfo: raw.vehicleDescription || raw.vehicleInfo || raw.vehicle ||
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

async function upsertInvoices(rawInvoices: RawInvoice[]): Promise<{ created: number; updated: number; skipped: number }> {
  const d = await getDb();
  if (!d) return { created: 0, updated: 0, skipped: 0 };

  const { invoices, customers } = await import("../../drizzle/schema");
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const ri of rawInvoices) {
    if (!ri.invoiceNumber) { skipped++; continue; }

    try {
      // Check if invoice already exists — UPDATE if it does (tickets evolve from draft → finalized)
      const existing = await d.select({ id: invoices.id, totalAmount: invoices.totalAmount })
        .from(invoices)
        .where(eq(invoices.invoiceNumber, ri.invoiceNumber))
        .limit(1);

      if (existing.length > 0) {
        // Update existing invoice — amount, service, date, payment info may have changed
        const updates: Record<string, any> = {};
        const ex = existing[0];
        // Always update amount if it changed (draft → finalized)
        if (ri.totalAmount > 0 && ri.totalAmount !== ex.totalAmount) updates.totalAmount = ri.totalAmount;
        if (ri.service) updates.serviceDescription = ri.service;
        if (ri.vehicleInfo) updates.vehicleInfo = ri.vehicleInfo;
        if (ri.date) updates.invoiceDate = new Date(ri.date);
        if (ri.paymentMethod && ri.paymentMethod !== "other") updates.paymentMethod = normalizePaymentMethod(ri.paymentMethod);
        if (ri.paymentStatus && ri.paymentStatus !== "paid") updates.paymentStatus = normalizePaymentStatus(ri.paymentStatus);
        if (ri.partsCost != null && ri.partsCost > 0) updates.partsCost = ri.partsCost;
        if (ri.laborCost != null && ri.laborCost > 0) updates.laborCost = ri.laborCost;
        if (ri.taxAmount != null && ri.taxAmount > 0) updates.taxAmount = ri.taxAmount;
        if (ri.customerPhone) updates.customerPhone = normalizePhone(ri.customerPhone);
        if (ri.customerName && ri.customerName !== "Unknown") updates.customerName = ri.customerName;

        if (Object.keys(updates).length > 0) {
          await d.update(invoices).set(updates).where(eq(invoices.id, ex.id));
          updated++;
        } else {
          skipped++;
        }
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

      // Fallback: match by customer name when phone is missing or didn't match
      if (!customerId && ri.customerName && ri.customerName !== "Unknown") {
        try {
          // Handle "LASTNAME, FIRSTNAME" format from ShopDriver
          const nameParts = ri.customerName.includes(",")
            ? ri.customerName.split(",").map((s: string) => s.trim())
            : [ri.customerName];
          const lastName = nameParts[0] || "";
          const firstName = nameParts[1] || "";

          if (lastName) {
            const nameMatch = firstName
              ? await d.select({ id: customers.id })
                  .from(customers)
                  .where(and(
                    eq(customers.lastName, lastName),
                    eq(customers.firstName, firstName),
                  ))
                  .limit(1)
              : await d.select({ id: customers.id })
                  .from(customers)
                  .where(eq(customers.lastName, lastName))
                  .limit(1);
            if (nameMatch.length === 1) customerId = nameMatch[0].id;
          }
        } catch (e) {
          console.warn("[services/shopDriverMirror] operation failed:", e);
          // Name matching is best-effort, don't fail the import
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

  return { created, updated, skipped };
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
// ─── DEBUG: Last fetch snapshot for diagnosis ──────────
let _lastFetchDebug: any = null;
export function debugLastFetch() { return _lastFetchDebug; }

export async function runFullMirror(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const start = Date.now();
  log.info("Starting full ShopDriver mirror sync");

  const token = await getSession();
  if (!token) {
    consecutiveFailures++;
    const msg = `🚨 ALG MIRROR DOWN: Auth failed (attempt #${consecutiveFailures}). No credentials or login rejected. Dashboard data is STALE.`;
    log.error(msg);
    await sendMirrorAlert(msg);
    return { recordsProcessed: 0, details: "Auth failed — no credentials or login rejected" };
  }

  // Fetch in parallel
  let [rawCustomers, rawInvoices] = await Promise.all([
    fetchCustomers(token),
    fetchInvoices(token),
  ]);

  // Debug snapshot — capture first 5 invoices' key fields
  _lastFetchDebug = {
    invoiceCount: rawInvoices.length,
    customerCount: rawCustomers.length,
    sampleInvoices: rawInvoices.slice(0, 5).map(i => ({
      invoiceNumber: i.invoiceNumber,
      customerName: i.customerName,
      date: i.date,
      totalAmount: i.totalAmount,
      service: i.service?.substring(0, 60),
    })),
    sampleCustomers: rawCustomers.slice(0, 3).map(c => ({
      name: c.name,
      phone: c.phone,
    })),
  };

  // If we got 0 invoices, the token may have been invalidated by a shop login.
  // Force fresh re-auth and retry — this is the most common failure mode.
  if (rawInvoices.length === 0) {
    log.warn("0 invoices — possible token invalidation. Re-authenticating...");
    invalidateSession();
    const freshToken = await getSession();
    if (freshToken) {
      const [retryCust, retryInv] = await Promise.all([
        rawCustomers.length === 0 ? fetchCustomers(freshToken) : Promise.resolve(rawCustomers),
        fetchInvoices(freshToken),
      ]);
      rawCustomers = retryCust;
      rawInvoices = retryInv;
      if (rawInvoices.length > 0) {
        log.info(`Re-auth fixed it! Got ${rawInvoices.length} invoices on retry`);
      }
    }
  }

  // If we STILL got 0 invoices after retry, alert
  if (rawInvoices.length === 0) {
    consecutiveFailures++;
    invalidateSession(); // Force re-auth next time — session may be dead

    // Check how stale our data actually is
    const staleDays = await getDataStaleDays();
    const msg = `⚠️ ALG MIRROR: 0 invoices fetched (attempt #${consecutiveFailures}). ` +
      `Session invalidated for retry. ` +
      `${rawCustomers.length > 0 ? `Got ${rawCustomers.length} customers though.` : "0 customers too — auth may be broken."} ` +
      `Last invoice in DB: ${staleDays !== null ? `${staleDays} days ago` : "unknown"}.`;
    log.warn(msg);
    await sendMirrorAlert(msg);

    // Still upsert customers if we got any
    if (rawCustomers.length > 0) {
      await upsertCustomers(rawCustomers);
    }

    return { recordsProcessed: 0, details: `0 invoices fetched — session invalidated (fail #${consecutiveFailures})` };
  }

  // Store customers first (so invoice linking works)
  const custResult = await upsertCustomers(rawCustomers);
  const invResult = await upsertInvoices(rawInvoices);

  const duration = Date.now() - start;
  const total = custResult.created + custResult.updated + invResult.created + invResult.updated;

  // SUCCESS — reset failure tracking
  const wasDown = consecutiveFailures > 0;
  consecutiveFailures = 0;
  lastSuccessfulSync = new Date();

  const details = [
    `Customers: ${custResult.created} new, ${custResult.updated} updated (${rawCustomers.length} fetched)`,
    `Invoices: ${invResult.created} new, ${invResult.updated} updated, ${invResult.skipped} unchanged (${rawInvoices.length} fetched)`,
    `Duration: ${duration}ms`,
  ].join(" | ");

  log.info(`Mirror complete: ${details}`);

  // Alert recovery if it was previously down
  if (wasDown) {
    try {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(`✅ ALG MIRROR RECOVERED: ${invResult.created} new invoices, ${custResult.created} new customers imported.`);
    } catch (e) { console.warn("[shopDriverMirror:mirror] recovery telegram alert failed:", e); }
  }

  // ═══ PROPAGATE TO ALL SYSTEMS ═══
  // When new data comes from ALG, push it EVERYWHERE so all sites stay current
  if (invResult.created > 0 || custResult.created > 0) {
    // 1. Event bus → NOUR OS, Telegram, Automation Engine, all destinations
    try {
      const { dispatch } = await import("./eventBus");
      await dispatch("mirror_synced", {
        newInvoices: invResult.created,
        newCustomers: custResult.created,
        updatedCustomers: custResult.updated,
        totalInvoicesFetched: rawInvoices.length,
        source: "shopdriver_alg",
      }, { priority: "normal", source: "shopdriver_mirror" });
    } catch (e) { console.warn("[shopDriverMirror:mirror] event bus mirror_synced dispatch failed:", e); }

    // 2. Admin dashboard SSE → live update for anyone viewing admin
    try {
      const { pushToAdminDashboards } = await import("./realtimePush");
      pushToAdminDashboards({
        type: "mirror_synced",
        data: {
          newInvoices: invResult.created,
          newCustomers: custResult.created,
          source: "ALG",
          timestamp: new Date().toISOString(),
        },
      });
    } catch (e) { console.warn("[shopDriverMirror:mirror] admin SSE push failed:", e); }

    // 3. Realtime SSE revenue update → admin sees fresh numbers instantly
    try {
      const { emitRevenueUpdate, emitAlert } = await import("./realtime");
      // Get fresh revenue after import
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const d = await getDb();
      if (d) {
        const [todayRev] = await d.execute(sql`
          SELECT COALESCE(SUM(totalAmount), 0) as rev, COUNT(*) as cnt
          FROM invoices
          WHERE DATE(invoiceDate) = CURDATE() AND source = 'shopdriver'
        `);
        const rev = (todayRev as any[])?.[0];
        if (rev) {
          emitRevenueUpdate({
            todayRevenue: Math.round(Number(rev.rev) / 100), // cents → dollars
            jobCount: Number(rev.cnt),
          });
        }
      }
      emitAlert({
        type: "sync",
        message: `ALG imported ${invResult.created} invoices, ${custResult.created} customers`,
        severity: "info",
      });
    } catch (e) { console.warn("[shopDriverMirror:mirror] realtime SSE revenue update failed:", e); }

    // 4. Trigger immediate statenour sync → NOUR OS dashboard updates NOW
    try {
      const { syncToStatenour } = await import("../cron/jobs/statenourSync");
      // Fire and forget — don't block the mirror return
      syncToStatenour().catch(e => console.warn("[shopDriverMirror:mirror] statenour sync fire-and-forget failed:", e));
    } catch (e) { console.warn("[shopDriverMirror:mirror] statenour sync trigger failed:", e); }

    // 5. Nick AI memory
    try {
      const { remember } = await import("./nickMemory");
      await remember({
        type: "insight",
        content: `ShopDriver mirror imported ${invResult.created} new invoices and ${custResult.created} new customers. ` +
          `Total fetched: ${rawInvoices.length} invoices, ${rawCustomers.length} customers. ` +
          `This reflects physical shop activity not captured by online bookings.`,
        source: "shopdriver_mirror",
        confidence: 0.9,
      });
    } catch (e) { console.warn("[shopDriverMirror:mirror] memory save for mirror insight failed:", e); }
  }

  return { recordsProcessed: total, details };
}

// ─── ALERT HELPER ──────────────────────────────────────
// Rate-limited Telegram alerts for mirror failures
async function sendMirrorAlert(msg: string): Promise<void> {
  // Don't spam — cooldown between alerts
  if (lastAlertSent && Date.now() - lastAlertSent.getTime() < ALERT_COOLDOWN_MS) {
    // But escalate if it's been failing a LOT (>6 consecutive = 1.5 hours of failure)
    if (consecutiveFailures < 6) return;
  }

  try {
    const { sendTelegram } = await import("./telegram");
    await sendTelegram(msg);
    lastAlertSent = new Date();
  } catch (err) {
    log.error("Failed to send mirror alert to Telegram", { error: err instanceof Error ? err.message : String(err) });
  }
}

// ─── DATA STALENESS CHECK ──────────────────────────────
// Check how many days since the most recent invoice in our DB
async function getDataStaleDays(): Promise<number | null> {
  try {
    const d = await getDb();
    if (!d) return null;
    const { sql } = await import("drizzle-orm");
    const [rows] = await d.execute(sql`SELECT MAX(invoiceDate) as latest FROM invoices WHERE source = 'shopdriver'`);
    const latest = (rows as any[])?.[0]?.latest;
    if (!latest) return null;
    return Math.round((Date.now() - new Date(latest).getTime()) / (1000 * 60 * 60 * 24));
  } catch (e) {
    console.warn("[services/shopDriverMirror] operation failed:", e);
    return null;
  }
}

// ─── HISTORICAL BACKFILL ──────────────────────────────────
// Fetches ALL invoice history by paginating through every page and
// probing date-range endpoints. Called manually via bridge, not cron.

export async function runHistoricalBackfill(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const start = Date.now();
  log.info("Starting historical backfill — fetching ALL invoice history");

  const token = await getSession();
  if (!token) {
    return { recordsProcessed: 0, details: "Auth failed — check credentials" };
  }

  let allInvoices: RawInvoice[] = [];
  let allCustomers: RawCustomer[] = [];
  const probeResults: string[] = [];

  // ═══ STRATEGY 1: Paginate through ALL pages of each endpoint ═══
  const paginatedEndpoints = [
    "/api/ticket/listRecentTickets",
    "/api/ticket/listTicketSessions",
    "/api/Report/listTotalSales",
    "/api/Search/getTicketSearch",
  ];

  for (const base of paginatedEndpoints) {
    let page = 1;
    let totalForEndpoint = 0;
    const maxPages = 100; // Safety limit

    while (page <= maxPages) {
      try {
        const url = `${SHOPDRIVER_API}${base}?pageNumber=${page}&pageSize=500`;
        const res = await fetch(url, {
          headers: HEADERS(token),
          signal: AbortSignal.timeout(30000),
        });

        if (isSessionKicked(res)) {
          invalidateSession();
          const freshToken = await getSession();
          if (!freshToken) break;
          continue; // Retry same page with fresh token
        }

        if (!res.ok) break;

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) break;

        const data = await res.json();
        const items = Array.isArray(data) ? data
          : (data.invoices || data.tickets || data.data || data.items || data.result || data.results || []);
        const list = Array.isArray(items) ? items : [];

        if (list.length === 0) break; // No more pages

        const invoices = list.map(normalizeInvoiceJson);
        allInvoices.push(...invoices);
        totalForEndpoint += list.length;
        page++;

        // If we got less than pageSize, this is the last page
        if (list.length < 500) break;
      } catch (err) {
        log.warn(`Backfill page ${page} of ${base} failed`, { error: err instanceof Error ? err.message : String(err) });
        break;
      }
    }

    if (totalForEndpoint > 0) {
      probeResults.push(`${base}: ${totalForEndpoint} tickets (${page - 1} pages)`);
      break; // Found a working endpoint, don't duplicate
    }
  }

  // ═══ STRATEGY 2: Try date-range parameters (common ASP.NET patterns) ═══
  if (allInvoices.length < 100) {
    const dateParams = [
      "startDate=2020-01-01&endDate=2026-12-31",
      "dateFrom=2020-01-01&dateTo=2026-12-31",
      "fromDate=01/01/2020&toDate=12/31/2026",
      "from=2020-01-01&to=2026-12-31",
      "start=2020-01-01&end=2026-12-31",
    ];
    const dateEndpoints = [
      "/api/Report/listTotalSales",
      "/api/ticket/listTicketSessions",
      "/api/Report/getSalesReport",
      "/api/Report/getInvoiceReport",
      "/api/Report/listInvoices",
    ];

    for (const ep of dateEndpoints) {
      for (const dp of dateParams) {
        try {
          const url = `${SHOPDRIVER_API}${ep}?${dp}&pageNumber=1&pageSize=1000`;
          const res = await fetch(url, {
            headers: HEADERS(token),
            signal: AbortSignal.timeout(30000),
          });

          if (!res.ok || isSessionKicked(res)) continue;

          const contentType = res.headers.get("content-type") || "";
          if (!contentType.includes("application/json")) continue;

          const data = await res.json();
          const items = Array.isArray(data) ? data
            : (data.invoices || data.tickets || data.data || data.items || data.result || data.results || []);
          const list = Array.isArray(items) ? items : [];

          if (list.length > 0) {
            probeResults.push(`DATE: ${ep}?${dp} → ${list.length} items`);
            const invoices = list.map(normalizeInvoiceJson);
            allInvoices.push(...invoices);

            // If this date endpoint works, paginate through it fully
            if (list.length >= 1000) {
              let page = 2;
              while (page <= 100) {
                try {
                  const pageUrl = `${SHOPDRIVER_API}${ep}?${dp}&pageNumber=${page}&pageSize=1000`;
                  const pageRes = await fetch(pageUrl, {
                    headers: HEADERS(token),
                    signal: AbortSignal.timeout(30000),
                  });
                  if (!pageRes.ok) break;
                  const pageData = await pageRes.json();
                  const pageItems = Array.isArray(pageData) ? pageData
                    : (pageData.invoices || pageData.tickets || pageData.data || pageData.items || pageData.result || pageData.results || []);
                  const pageList = Array.isArray(pageItems) ? pageItems : [];
                  if (pageList.length === 0) break;
                  allInvoices.push(...pageList.map(normalizeInvoiceJson));
                  if (pageList.length < 1000) break;
                  page++;
                } catch (e) { console.warn("[shopDriverMirror:backfill] pagination fetch failed:", e); break; }
              }
            }
            break; // Found working date endpoint
          }
        } catch (e) { console.warn("[shopDriverMirror:backfill] date endpoint probe failed:", e); }
      }
      if (allInvoices.length > 100) break; // Found enough
    }
  }

  // ═══ STRATEGY 3: Try to get all customers with pagination too ═══
  const custEndpoints = [
    "/api/Customer/listCustomers",
    "/api/Search/getCustomerSearch",
  ];

  for (const base of custEndpoints) {
    let page = 1;
    let totalCust = 0;

    while (page <= 100) {
      try {
        const url = `${SHOPDRIVER_API}${base}?pageNumber=${page}&pageSize=500`;
        const res = await fetch(url, {
          headers: HEADERS(token),
          signal: AbortSignal.timeout(30000),
        });

        if (!res.ok || isSessionKicked(res)) break;

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) break;

        const data = await res.json();
        const items = Array.isArray(data) ? data
          : (data.customers || data.data || data.items || data.result || data.results || []);
        const list = Array.isArray(items) ? items : [];

        if (list.length === 0) break;

        allCustomers.push(...list.map(normalizeCustomerJson));
        totalCust += list.length;
        page++;

        if (list.length < 500) break;
      } catch (e) { console.warn("[services/shopDriverMirror] customer page fetch failed:", e); break; }
    }

    if (totalCust > 0) {
      probeResults.push(`Customers: ${totalCust} (${page - 1} pages)`);
      break;
    }
  }

  // ═══ DEDUPLICATE invoices before upserting ═══
  const seen = new Set<string>();
  const uniqueInvoices = allInvoices.filter(inv => {
    if (!inv.invoiceNumber || seen.has(inv.invoiceNumber)) return false;
    seen.add(inv.invoiceNumber);
    return true;
  });

  log.info(`Backfill fetched ${uniqueInvoices.length} unique invoices (from ${allInvoices.length} raw), ${allCustomers.length} customers`);

  // Upsert to DB
  let custResult = { created: 0, updated: 0 };
  let invResult = { created: 0, updated: 0, skipped: 0 };

  if (allCustomers.length > 0) {
    custResult = await upsertCustomers(allCustomers);
  }
  if (uniqueInvoices.length > 0) {
    invResult = await upsertInvoices(uniqueInvoices);
  }

  const duration = Date.now() - start;
  const total = custResult.created + custResult.updated + invResult.created + invResult.updated;

  const details = [
    `Invoices: ${invResult.created} new, ${invResult.updated} updated, ${invResult.skipped} unchanged (${uniqueInvoices.length} fetched)`,
    `Customers: ${custResult.created} new, ${custResult.updated} updated (${allCustomers.length} fetched)`,
    `Probes: ${probeResults.join(" | ") || "no working endpoints found"}`,
    `Duration: ${duration}ms`,
  ].join(" | ");

  log.info(`Historical backfill complete: ${details}`);

  // Trigger enrichment after backfill
  if (invResult.created > 0) {
    try {
      const { enrichCustomerData } = await import("./dataPipelines");
      const enrichResult = await enrichCustomerData();
      log.info(`Post-backfill enrichment: ${enrichResult.details}`);
    } catch (e) { console.warn("[shopDriverMirror:backfill] post-backfill customer enrichment failed:", e); }
  }

  return { recordsProcessed: total, details };
}

// ─── HEALTH CHECK (called by scheduler) ────────────────
// Returns health status for the ALG mirror — used by heartbeat tier
export async function checkMirrorHealth(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const staleDays = await getDataStaleDays();
  const status = {
    consecutiveFailures,
    lastSuccessfulSync: lastSuccessfulSync?.toISOString() || "never this session",
    staleDays,
    sessionActive: mirrorSession !== null && Date.now() < (mirrorSession?.expiresAt || 0),
  };

  // CRITICAL: Invoice data is more than 1 day stale
  if (staleDays !== null && staleDays > 1) {
    const msg = `🚨 ALG DATA STALE: Last invoice is ${staleDays} days old! ` +
      `Consecutive sync failures: ${consecutiveFailures}. ` +
      `Dashboard stats, revenue, and NOUR OS are all showing outdated data. ` +
      `Check AUTO_LABOR_USERNAME/PASSWORD env vars and ShopDriver endpoint availability.`;
    await sendMirrorAlert(msg);
    return { recordsProcessed: 0, details: `STALE: ${staleDays}d old | fails: ${consecutiveFailures}` };
  }

  // WARNING: Some failures but data not yet stale
  if (consecutiveFailures > 2) {
    return { recordsProcessed: 0, details: `WARNING: ${consecutiveFailures} consecutive failures | data: ${staleDays ?? "?"}d old` };
  }

  return { recordsProcessed: 1, details: `OK | data: ${staleDays ?? 0}d old | session: ${status.sessionActive ? "active" : "expired"}` };
}

// ─── ALG ENDPOINT PROBE ──────────────────────────────────
// Probe probable ALG API endpoints to discover what data is available.
// Returns status/shape info for each endpoint without side effects.

interface ProbeResult {
  status: number;
  isJson: boolean;
  sampleSize: number;
  firstChars: string;
}

export async function probeAlgEndpoints(): Promise<Record<string, ProbeResult>> {
  const token = await getSession();
  if (!token) {
    log.error("probeAlgEndpoints: could not authenticate");
    return { _error: { status: 0, isJson: false, sampleSize: 0, firstChars: "Auth failed — no token" } };
  }

  const endpoints = [
    "/api/Vehicle/listVehicles?pageNumber=1&pageSize=10",
    "/api/Vehicle/getVehicleHistory?pageNumber=1&pageSize=10",
    "/api/Estimate/listEstimates?pageNumber=1&pageSize=10",
    "/api/ticket/listEstimates?pageNumber=1&pageSize=10",
    "/api/Recommendation/list?pageNumber=1&pageSize=10",
    "/api/Inventory/listParts?pageNumber=1&pageSize=10",
    "/api/Parts/search?pageNumber=1&pageSize=10",
    "/api/Appointment/listAppointments?pageNumber=1&pageSize=10",
    "/api/Schedule/getSchedule",
    "/api/PurchaseOrder/list?pageNumber=1&pageSize=10",
    "/api/Payment/listPayments?pageNumber=1&pageSize=10",
    "/api/LaborMatrix/list?pageNumber=1&pageSize=10",
    "/api/Report/getARReport",
    "/api/Report/getProfitReport",
    "/api/Report/getTaxReport",
    "/api/WorkOrder/listWorkOrders?pageNumber=1&pageSize=10",
    "/api/Note/list?pageNumber=1&pageSize=10",
    "/api/ticket/getTicketPdf?ticketId=1",
    "/api/Report/getInvoicePdf?invoiceId=1",
    "/api/Estimate/getEstimatePdf?estimateId=1",
  ];

  const results: Record<string, ProbeResult> = {};

  for (const endpoint of endpoints) {
    const url = `${SHOPDRIVER_API}${endpoint}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: HEADERS(token),
        signal: AbortSignal.timeout(5000),
      });

      const body = await res.text();
      let isJson = false;
      try {
        JSON.parse(body);
        isJson = true;
      } catch (e) { /* expected for non-JSON responses */ console.warn("[services/shopDriverMirror] operation failed:", e); }

      const firstChars = body.substring(0, 200);
      log.info(`[probe] ${endpoint} → ${res.status} json=${isJson} len=${body.length}`, { firstChars });

      results[endpoint] = {
        status: res.status,
        isJson,
        sampleSize: body.length,
        firstChars,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[probe] ${endpoint} → ERROR: ${msg}`);
      results[endpoint] = {
        status: 0,
        isJson: false,
        sampleSize: 0,
        firstChars: `Error: ${msg}`,
      };
    }
  }

  return results;
}
