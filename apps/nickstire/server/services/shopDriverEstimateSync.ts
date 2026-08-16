/**
 * ShopDriver Estimate Mirror — ALG walk-in estimates (declined work)
 *
 * In ALG / ShopDriver Elite, an ESTIMATE = a customer walked into the shop,
 * got a physical quote, and did NOT get the work done. That is a declined
 * sale — a recovery opportunity.
 *
 * This service:
 *   - Pulls estimates from ShopDriver's /api/Estimate/* endpoints using the
 *     same JWT session pattern as shopDriverMirror.ts (authSession reused).
 *   - Upserts into the `alg_estimates` table keyed by externalId.
 *   - Matches estimates against the `invoices` table (phone + ±10% amount
 *     + within 30d) to flag which ones converted. Unmatched estimates = lost
 *     sales that the declined-work-recovery cron will follow up on.
 *   - Never destroys follow_up_7d_sent / follow_up_30d_sent flags on update.
 *
 * Shop-protection: this service MUST be invoked through runIfAdminActive()
 * in the scheduler. Probing ShopDriver kicks the shop counter's live session.
 *
 * Companion files:
 *   - drizzle/schema.ts              — `algEstimates` table definition
 *   - drizzle/0027_alg_estimates.sql — migration
 *   - server/cron/scheduler.ts       — pulse-tier wiring (15 min)
 *   - server/admin-stats.ts          — consumer of real conversion math
 *   - server/cron/jobs/declinedWorkRecovery.ts — 7d/30d SMS follow-ups
 */

import { eq, and, gte, lte, isNull, sql, desc } from "drizzle-orm";
import { DECLINED_RECOVERY_WINDOW_DAYS } from "@shared/const";
import { createLogger } from "../lib/logger";
import { normalizePhone } from "../lib/phone";

const log = createLogger("shopdriver-estimate-sync");

const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";
const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";

// ─── STATE ──────────────────────────────────────────────

let lastEstimateSync: Date | null = null;
let consecutiveEstimateFailures = 0;

/** Expose freshness for the bridge endpoints (same shape as shopDriverMirror). */
export function getLastEstimateSync(): Date | null {
  return lastEstimateSync;
}

// ─── SESSION REUSE ──────────────────────────────────────
// We authenticate against ShopDriver ourselves to avoid depending on
// shopDriverMirror's private module state. The endpoints + session flow
// are identical so the shop-session impact is the same — runIfAdminActive
// gates us before we ever call this.

let sessionToken: string | null = null;
let sessionExpiresAt = 0;
let lastAuthAt = 0;

async function authenticate(): Promise<string | null> {
  if (sessionToken && Date.now() < sessionExpiresAt) return sessionToken;

  // 5-minute auth cooldown to avoid hammering login when estimates endpoint is
  // down but we keep getting called from the scheduler.
  const AUTH_COOLDOWN_MS = 5 * 60 * 1000;
  if (sessionToken && Date.now() - lastAuthAt < AUTH_COOLDOWN_MS) {
    return sessionToken;
  }

  const username = process.env.AUTO_LABOR_USERNAME || process.env.ALG_USERNAME;
  const password = process.env.AUTO_LABOR_PASSWORD || process.env.ALG_PASSWORD;
  if (!username || !password) {
    log.error("Missing AUTO_LABOR_USERNAME/PASSWORD env vars");
    return null;
  }

  try {
    const res = await fetch(`${SHOPDRIVER_API}/api/account/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": SHOPDRIVER_BASE,
        "Referer": `${SHOPDRIVER_BASE}/`,
      },
      body: JSON.stringify({ login: username, password, ipAddress: "", location: "" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      log.error(`Estimate-sync login failed: HTTP ${res.status}`, { body: err.slice(0, 300) });
      return null;
    }
    const data = await res.json();
    const token = data.token || data.jwt || data.accessToken || data.access_token ||
      data.data?.token || data.data?.jwt || data.result?.token;
    if (typeof token === "string" && token.length > 20) {
      sessionToken = token;
      sessionExpiresAt = Date.now() + 30 * 60 * 1000; // 30 min TTL
      lastAuthAt = Date.now();
      return token;
    }
    log.error("Estimate-sync login: couldn't extract token", {
      keys: Object.keys(data),
    });
    return null;
  } catch (err) {
    log.error("Estimate-sync login threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function buildHeaders(token: string): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/html, */*",
    "Referer": `${SHOPDRIVER_BASE}/`,
    "Authorization": `Bearer ${token}`,
  };
}

// ─── TYPES ──────────────────────────────────────────────

interface RawEstimate {
  externalId: string;
  customerName: string;
  customerPhone: string | null;
  vehicleInfo: string | null;
  serviceDescription: string | null;
  estimatedAmount: number; // cents
  estimateDate: Date;
}

// ─── FETCH ──────────────────────────────────────────────

function parseDollarsToCents(input: unknown): number {
  if (typeof input === "number") return Math.round(input * 100);
  const cleaned = String(input ?? "").replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function normalizeEstimateJson(raw: Record<string, unknown>): RawEstimate | null {
  const idRaw =
    raw.estimateNumber ?? raw.estimateId ?? raw.ticketNumber ?? raw.ticketId ?? raw.id;
  const externalId = idRaw == null ? "" : String(idRaw);
  if (!externalId) return null;

  const customer = raw.customer as Record<string, unknown> | undefined;
  const customerName =
    (raw.customerName as string) ||
    (customer?.name as string) ||
    [raw.firstName, raw.lastName].filter(Boolean).join(" ") ||
    [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") ||
    "Unknown";

  const phoneRaw =
    (raw.primaryNumber as string) ||
    (raw.primaryPhone as string) ||
    (raw.customerPhone as string) ||
    (customer?.phone as string) ||
    "";

  const amountRaw =
    (raw.totalAmount as number | string | undefined) ??
    (raw.total as number | string | undefined) ??
    (raw.amount as number | string | undefined) ??
    (raw.estimatedAmount as number | string | undefined) ??
    (raw.grandTotal as number | string | undefined) ??
    0;

  const dateRaw =
    (raw.estimateDate as string | undefined) ||
    (raw.date as string | undefined) ||
    (raw.createdAt as string | undefined) ||
    (raw.ticketDate as string | undefined) ||
    (raw.accessedDate as string | undefined) ||
    new Date().toISOString();
  const parsedDate = new Date(dateRaw);
  const estimateDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  const vehicleInfo =
    (raw.vehicleDescription as string) ||
    (raw.vehicleInfo as string) ||
    (raw.vehicle as string) ||
    [raw.vehicleYear, raw.vehicleMake, raw.vehicleModel].filter(Boolean).join(" ") ||
    null;

  const serviceDescription =
    (raw.serviceDescription as string) ||
    (raw.description as string) ||
    (raw.service as string) ||
    (Array.isArray(raw.services) ? (raw.services as unknown[]).join(", ") : null) ||
    null;

  return {
    externalId,
    customerName: customerName || "Unknown",
    customerPhone: normalizePhone(phoneRaw) || null,
    vehicleInfo: vehicleInfo || null,
    serviceDescription: serviceDescription || null,
    estimatedAmount: parseDollarsToCents(amountRaw),
    estimateDate,
  };
}

/**
 * Wave-97: normalize a /api/ticket/listRecentTickets row (which has
 * ticketType + invoiceNumber + estimateNumber) into a RawEstimate.
 * This is the primary path now that we know the API response shape.
 *
 * Key field map:
 *   - external_id ← String(estimateNumber) when present, else ticketId
 *   - estimateDate ← raw.estimateDate (ALG sets this even on tickets
 *     that later become invoices, so it captures the original quote
 *     date — perfect for declined-work-recovery cron timing)
 *   - estimatedAmount ← raw.total (in dollars, multiply by 100)
 *   - vehicle ← year + make + model (denormalized in this endpoint)
 */
function normalizeTicketAsEstimate(raw: Record<string, unknown>): RawEstimate {
  const estimateNumber = raw.estimateNumber;
  const ticketId = raw.ticketId as string | undefined;
  const externalId = estimateNumber != null && estimateNumber !== 0
    ? String(estimateNumber)
    : (ticketId || `unknown-${Date.now()}`);

  const firstName = (raw.firstName as string) || "";
  const lastName = (raw.lastName as string) || "";
  const businessName = (raw.businessName as string) || "";
  const customerName = businessName || `${firstName} ${lastName}`.trim() || "Unknown";

  const phoneRaw =
    (raw.primaryNumber as string) ||
    (raw.secondaryNumber as string) ||
    "";

  const totalRaw = raw.total as number | string | undefined;
  const amountCents = typeof totalRaw === "number"
    ? Math.round(totalRaw * 100)
    : parseDollarsToCents(String(totalRaw ?? "0"));

  const dateRaw =
    (raw.estimateDate as string | undefined) ||
    (raw.invoiceDate as string | undefined) ||
    (raw.customerDateCreated as string | undefined) ||
    new Date().toISOString();
  const parsed = new Date(dateRaw);
  const estimateDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  const year = raw.year ? String(raw.year) : "";
  const make = (raw.make as string) || "";
  const model = (raw.model as string) || "";
  const vehicleInfo = [year, make, model].filter(Boolean).join(" ") || null;

  return {
    externalId,
    customerName,
    customerPhone: normalizePhone(phoneRaw) || null,
    vehicleInfo,
    serviceDescription: (raw.description as string) || null,
    estimatedAmount: amountCents,
    estimateDate,
  };
}

async function fetchEstimates(token: string): Promise<RawEstimate[]> {
  // ─── PRIMARY PATH (wave-97 + wave-98 pagination): /api/ticket/listRecentTickets ──
  // The mirror service uses this same endpoint to pull invoices. It
  // returns BOTH invoices (ticketType=0) and estimates (ticketType=1)
  // mixed together. We filter for estimate-type rows and route them
  // here. Confirmed working 2026-05-07 against production tenant.
  //
  // Wave-98: walk pages 1-3 so the live cron picks up estimates beyond
  // the most-recent 50 tickets. Each page is 50 (server-capped).
  // Throttle 1s between pages to avoid session pressure.
  const MAX_PAGES = 3;
  const PAGE_SIZE = 50;
  const collected: RawEstimate[] = [];
  let primaryPathSucceeded = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const res = await fetch(
        `${SHOPDRIVER_API}/api/ticket/listRecentTickets?pageNumber=${page}&pageSize=${PAGE_SIZE}`,
        { headers: buildHeaders(token), signal: AbortSignal.timeout(30000) }
      );
      log.info(`Estimate primary probe: page ${page} → ${res.status}`);
      if (!res.ok) {
        if (page === 1) break;
        // Mid-pagination failure — keep what we have
        break;
      }
      if (!(res.headers.get("content-type") || "").includes("application/json")) break;

      const data = await res.json() as Array<Record<string, unknown>>;
      const tickets = Array.isArray(data) ? data : [];
      if (tickets.length === 0) break;

      primaryPathSucceeded = true;
      const estimateTickets = tickets.filter((t) => {
        if (t.ticketType === 1) return true;
        const inv = t.invoiceNumber;
        const est = t.estimateNumber;
        return (inv == null || inv === 0) && est != null && est !== 0;
      });
      log.info(`Page ${page}: ${tickets.length} tickets · ${estimateTickets.length} estimates`);
      collected.push(...estimateTickets.map((t) => normalizeTicketAsEstimate(t)));

      // Last page reached
      if (tickets.length < PAGE_SIZE) break;
      // Throttle between pages
      if (page < MAX_PAGES) await new Promise((rs) => setTimeout(rs, 1000));
    } catch (err) {
      log.warn(`Primary estimate probe page ${page} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      if (page === 1) break;
      break;
    }
  }
  if (primaryPathSucceeded && collected.length > 0) {
    log.info(`Estimate primary path: ${collected.length} estimates total across pages`);
    return collected;
  }

  // Endpoint probe order — different ShopDriver tenants expose different
  // names. The primary candidates came from SPA bundle inspection. As of
  // 2026-05-05 production probe returned 0 results from the original 4
  // candidates, so we expanded the list significantly. If JSON probe
  // fails, falls through to HTML scrape of the SPA's Estimates page.
  const endpoints = [
    // Original 4 probe candidates
    "/api/Estimate/listEstimates?pageNumber=1&pageSize=500",
    "/api/ticket/listEstimates?pageNumber=1&pageSize=500",
    "/api/Estimate/list?pageNumber=1&pageSize=500",
    "/api/Report/listEstimates?pageNumber=1&pageSize=500",
    // Common ShopDriver patterns — different tenants expose different names
    "/api/Ticket/listOpenEstimates?pageNumber=1&pageSize=500",
    "/api/Estimate/listOpen?pageNumber=1&pageSize=500",
    "/api/Estimates?pageNumber=1&pageSize=500",
    "/api/Customer/listEstimates?pageNumber=1&pageSize=500",
    // Date-range variants — some tenants require dates
    `/api/Estimate/list?fromDate=${dateNDaysAgo(60)}&toDate=${todayISO()}`,
    `/api/ticket/listEstimates?fromDate=${dateNDaysAgo(60)}&toDate=${todayISO()}`,
    // Singular without "/list"
    "/api/Estimate?pageNumber=1&pageSize=500",
    "/api/Estimate/getAll?pageNumber=1&pageSize=500",
    // Search-style (some tenants only expose this)
    "/api/Search/estimates?query=&pageNumber=1&pageSize=500",
    // Report-style (matches getInvoiceReport pattern)
    "/api/Report/getEstimateReport?pageNumber=1&pageSize=500",
    "/api/Report/getEstimates?pageNumber=1&pageSize=500",
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${SHOPDRIVER_API}${endpoint}`, {
        headers: buildHeaders(token),
        signal: AbortSignal.timeout(30000),
      });
      log.info(`Estimate endpoint probe: ${endpoint} → ${res.status} ${res.headers.get("content-type") || "no-type"}`);

      if (res.status === 401 || res.status === 403) {
        // Token kicked — clear and bail; the scheduler will retry next tier.
        sessionToken = null;
        sessionExpiresAt = 0;
        log.warn(`Estimate endpoint returned ${res.status}; session invalidated`);
        return [];
      }
      if (!res.ok) continue;

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) continue;

      const data = await res.json() as Record<string, unknown> | unknown[];
      const items = Array.isArray(data)
        ? data
        : ((data as Record<string, unknown>).estimates as unknown[]) ||
          ((data as Record<string, unknown>).tickets as unknown[]) ||
          ((data as Record<string, unknown>).data as unknown[]) ||
          ((data as Record<string, unknown>).items as unknown[]) ||
          ((data as Record<string, unknown>).result as unknown[]) ||
          ((data as Record<string, unknown>).results as unknown[]) ||
          ((data as Record<string, unknown>).records as unknown[]) ||
          ((data as Record<string, unknown>).rows as unknown[]) ||
          ((data as Record<string, unknown>).list as unknown[]) ||
          [];
      const list = Array.isArray(items) ? items : [];
      if (list.length === 0) {
        log.info(`${endpoint} returned JSON but 0 estimates`);
        continue;
      }

      const normalized = list
        .map((r) => normalizeEstimateJson(r as Record<string, unknown>))
        .filter((r): r is RawEstimate => r !== null);
      log.info(`Fetched ${normalized.length} estimates from ${endpoint}`);
      return normalized;
    } catch (err) {
      log.warn(`Estimate endpoint ${endpoint} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── HTML SCRAPE FALLBACK ──────────────────────────────
  // None of the JSON endpoints returned data. Try scraping the ALG portal's
  // Estimates page HTML. The portal renders estimates as a server-side
  // table; we extract rows via regex. Less reliable than JSON but better
  // than empty.
  log.info("All JSON endpoints empty/failed — trying HTML scrape fallback");
  try {
    const htmlEstimates = await fetchEstimatesViaHtml(token);
    if (htmlEstimates.length > 0) {
      log.info(`HTML scrape returned ${htmlEstimates.length} estimates`);
      return htmlEstimates;
    }
  } catch (err) {
    log.warn("HTML scrape fallback failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log.warn("No estimate data returned from any endpoint or HTML scrape");
  return [];
}

// ─── ESTIMATE ENDPOINT DIAGNOSTIC ──────────────────────
// Pings every JSON + HTML endpoint candidate and returns what each one
// said. Used by admin "Discover Estimate Endpoints" button. Doesn't
// upsert — just observes — so it's safe to run for diagnostics.
//
// Returns the actual status code, content-type, body sample, and item
// count for each candidate. Lets us figure out which endpoint name
// Moe's ShopDriver tenant actually exposes.
export async function probeEstimateEndpoints(): Promise<Array<{
  endpoint: string;
  type: "json" | "html";
  status: number;
  contentType: string;
  bytes: number;
  itemCount: number | null;
  firstChars: string;
}>> {
  const token = await authenticate();
  if (!token) {
    return [{
      endpoint: "/api/login",
      type: "json",
      status: 0,
      contentType: "auth_failed",
      bytes: 0,
      itemCount: null,
      firstChars: "Authentication failed — could not get session token",
    }];
  }

  const jsonEndpoints = [
    "/api/Estimate/listEstimates?pageNumber=1&pageSize=10",
    "/api/ticket/listEstimates?pageNumber=1&pageSize=10",
    "/api/Estimate/list?pageNumber=1&pageSize=10",
    "/api/Report/listEstimates?pageNumber=1&pageSize=10",
    "/api/Ticket/listOpenEstimates?pageNumber=1&pageSize=10",
    "/api/Estimate/listOpen?pageNumber=1&pageSize=10",
    "/api/Estimates?pageNumber=1&pageSize=10",
    "/api/Estimate?pageNumber=1&pageSize=10",
    "/api/Estimate/getAll?pageNumber=1&pageSize=10",
    "/api/Search/estimates?query=&pageNumber=1&pageSize=10",
    "/api/Report/getEstimateReport?pageNumber=1&pageSize=10",
    "/api/Customer/listEstimates?pageNumber=1&pageSize=10",
    `/api/Estimate/list?fromDate=${dateNDaysAgo(60)}&toDate=${todayISO()}`,
  ];

  const htmlEndpoints = [
    `${SHOPDRIVER_BASE}/Estimate/list`,
    `${SHOPDRIVER_BASE}/Estimates`,
    `${SHOPDRIVER_BASE}/Estimate`,
    `${SHOPDRIVER_BASE}/Reports/Estimates`,
    `${SHOPDRIVER_BASE}/Customer/Estimates`,
  ];

  const results: Array<{
    endpoint: string;
    type: "json" | "html";
    status: number;
    contentType: string;
    bytes: number;
    itemCount: number | null;
    firstChars: string;
  }> = [];

  // JSON probes
  for (const path of jsonEndpoints) {
    const url = `${SHOPDRIVER_API}${path}`;
    try {
      const res = await fetch(url, {
        headers: buildHeaders(token),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.text();
      const ct = res.headers.get("content-type") || "";
      let itemCount: number | null = null;
      if (ct.includes("json")) {
        try {
          const data = JSON.parse(body) as Record<string, unknown> | unknown[];
          if (Array.isArray(data)) {
            itemCount = data.length;
          } else {
            const pickArr = (k: string) =>
              Array.isArray((data as Record<string, unknown>)[k])
                ? ((data as Record<string, unknown>)[k] as unknown[]).length
                : 0;
            itemCount =
              pickArr("estimates") || pickArr("tickets") || pickArr("data") ||
              pickArr("items") || pickArr("result") || pickArr("results") ||
              pickArr("records") || pickArr("rows") || pickArr("list") || 0;
          }
        } catch {
          itemCount = null;
        }
      }
      results.push({
        endpoint: path,
        type: "json",
        status: res.status,
        contentType: ct,
        bytes: body.length,
        itemCount,
        firstChars: body.slice(0, 200),
      });
    } catch (err) {
      results.push({
        endpoint: path,
        type: "json",
        status: 0,
        contentType: "error",
        bytes: 0,
        itemCount: null,
        firstChars: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // HTML probes
  for (const url of htmlEndpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          ...buildHeaders(token),
          "Accept": "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.text();
      const ct = res.headers.get("content-type") || "";
      // Estimate row count via regex (rough)
      const rowMatch = body.match(/<tr[^>]*data-(?:estimate|ticket)-id="/gi);
      const itemCount = rowMatch ? rowMatch.length : null;
      results.push({
        endpoint: url.replace(SHOPDRIVER_BASE, ""),
        type: "html",
        status: res.status,
        contentType: ct,
        bytes: body.length,
        itemCount,
        firstChars: body.slice(0, 200),
      });
    } catch (err) {
      results.push({
        endpoint: url,
        type: "html",
        status: 0,
        contentType: "error",
        bytes: 0,
        itemCount: null,
        firstChars: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

// ─── HTML SCRAPE FALLBACK ─────────────────────────────────
// When none of the JSON endpoints work, we fall back to scraping the
// ALG portal's Estimates page. The portal is a SPA but server-renders
// the initial table for SEO, so we can extract via regex.

function dateNDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Last-resort HTML scrape of the ALG Estimates page.
 * Tries multiple URL patterns + extracts table rows via regex.
 *
 * NOTE: this is fragile by nature — DOM structure can change without
 * notice. Per probe, log the first 500 chars of HTML so we can debug
 * when ShopDriver redesigns the page.
 */
async function fetchEstimatesViaHtml(token: string): Promise<RawEstimate[]> {
  // /recent is the proven page (operator screenshot 2026-05-07). It mixes
  // Invoice# + Estimate# rows in nested <table> blocks. We extract only
  // Estimate# rows here. The /Estimate/* URLs are SPA route guesses that
  // historically returned empty bodies — kept as last-resort fallbacks.
  const htmlEndpoints = [
    `${SHOPDRIVER_BASE}/recent`,
    `${SHOPDRIVER_BASE}/Estimate/list`,
    `${SHOPDRIVER_BASE}/Estimates`,
    `${SHOPDRIVER_BASE}/Estimate`,
    `${SHOPDRIVER_BASE}/Reports/Estimates`,
    `${SHOPDRIVER_BASE}/Customer/Estimates`,
  ];

  for (const url of htmlEndpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          ...buildHeaders(token),
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
      log.info(`HTML scrape probe: ${url} → ${res.status}`);
      if (!res.ok) continue;

      const html = await res.text();
      // Quick sanity: if this is the SPA shell (no estimates content), bail.
      if (html.length < 5000) continue;
      if (!/estimate/i.test(html)) continue;

      const rows: RawEstimate[] = [];

      // ─── Pattern 0 — /recent page format (nested <table> blocks) ──
      // The proven format from operator's 2026-05-07 screenshot. Each
      // ticket block contains "Invoice# XXXX" or "Estimate# XXXX",
      // customer "LASTNAME, FIRSTNAME", vehicle, date, total.
      // Mirrors parseInvoiceHtml in shopDriverMirror.ts but Estimate-only.
      if (url.endsWith("/recent")) {
        const blocks = html.split(/<table/gi).slice(1);
        for (const block of blocks) {
          const text = block
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          const estimateMatch = text.match(/Estimate#\s*(\d+)/i);
          if (!estimateMatch) continue; // skip Invoice# blocks — those go to invoices mirror

          const estimateNum = estimateMatch[1];
          const nameMatch = text.match(/([A-Z][A-Za-z'\-]+,\s*[A-Z][A-Za-z'\-\s]+)/);
          const customerName = nameMatch ? nameMatch[1].trim() : "Unknown";
          const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
          const dateStr = dateMatch ? dateMatch[1] : "";
          const amountMatch = text.match(/Total:\s*\$([0-9,]+\.\d{2})/i) || text.match(/\$([0-9,]+\.\d{2})/);
          const amountCents = amountMatch ? parseDollarsToCents(amountMatch[1]) : 0;
          const vehicleMatch = text.match(/\d{4}\s+[A-Z][A-Za-z\s\*\-]+/);
          const vehicle = vehicleMatch ? vehicleMatch[0].trim() : null;
          const phoneMatch = text.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
          const phone = phoneMatch ? `${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}` : null;

          rows.push({
            externalId: estimateNum,
            customerName,
            customerPhone: phone,
            vehicleInfo: vehicle,
            serviceDescription: null,
            estimatedAmount: amountCents,
            estimateDate: dateStr ? new Date(dateStr) : new Date(),
          });
        }
        if (rows.length > 0) {
          log.info(`HTML scrape (/recent) extracted ${rows.length} estimates`);
          return rows;
        }
        continue;
      }

      // ─── Pattern 1 — explicit data-estimate-id rows on /Estimate pages ──
      const rowPattern = /<tr[^>]*data-(?:estimate|ticket)-id="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;
      let m: RegExpExecArray | null;
      while ((m = rowPattern.exec(html)) !== null) {
        const id = m[1];
        const inner = m[2];
        const cells = [...inner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((mm) =>
          mm[1].replace(/<[^>]+>/g, "").trim(),
        );
        if (cells.length < 3) continue;

        // Heuristic column order: [estimate#, date, customer, vehicle, amount]
        // Different tenants reorder; try multiple positions for amount.
        const amountCell = cells.find((c) => /\$[\d,]+/.test(c)) || "0";
        const amountCents = parseDollarsToCents(amountCell);
        const dateCell = cells.find((c) => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c)) || "";
        const customerCell = cells.find((c) => c.length > 3 && !/\$|\d{1,2}\/\d{1,2}/.test(c)) || "Unknown";
        const vehicleCell = cells.find((c) => /\d{4}.*[A-Za-z]/.test(c)) || null;

        rows.push({
          externalId: id,
          customerName: customerCell,
          customerPhone: null,
          vehicleInfo: vehicleCell,
          serviceDescription: null,
          estimatedAmount: amountCents,
          estimateDate: dateCell ? new Date(dateCell) : new Date(),
        });
      }

      if (rows.length > 0) {
        log.info(`HTML scrape extracted ${rows.length} estimates from ${url}`);
        return rows;
      }
      // Otherwise try next URL
    } catch (err) {
      log.warn(`HTML scrape ${url} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return [];
}

// ─── DB UPSERT + MATCHING ──────────────────────────────

interface UpsertResult {
  created: number;
  updated: number;
  matchedNow: number;
  unmatched: number;
}

async function upsertEstimates(rawEstimates: RawEstimate[]): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, updated: 0, matchedNow: 0, unmatched: 0 };
  if (rawEstimates.length === 0) return result;

  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) {
    log.error("upsertEstimates: DB unavailable");
    return result;
  }

  const { algEstimates, invoices } = await import("../../drizzle/schema");

  for (const est of rawEstimates) {
    try {
      // Look up existing by externalId (unique key)
      const existing = await d
        .select({
          id: algEstimates.id,
          matchedInvoiceId: algEstimates.matchedInvoiceId,
          estimatedAmount: algEstimates.estimatedAmount,
        })
        .from(algEstimates)
        .where(eq(algEstimates.externalId, est.externalId))
        .limit(1);

      // Try to find a matching invoice — only if estimate has a phone.
      // Heuristic: same customerPhone, amount within ±10%, invoiceDate in
      // [estimateDate, estimateDate + 30d]. The ±10% fudge handles tax /
      // part substitutions between quote and final invoice.
      let matchedInvoiceId: number | null = null;
      let matchedAt: Date | null = null;
      if (est.customerPhone) {
        const low = Math.floor(est.estimatedAmount * 0.9);
        const high = Math.ceil(est.estimatedAmount * 1.1);
        const upperDate = new Date(est.estimateDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        const candidates = await d
          .select({ id: invoices.id, invoiceDate: invoices.invoiceDate })
          .from(invoices)
          .where(
            and(
              eq(invoices.customerPhone, est.customerPhone),
              gte(invoices.totalAmount, low),
              lte(invoices.totalAmount, high),
              gte(invoices.invoiceDate, est.estimateDate),
              lte(invoices.invoiceDate, upperDate),
            ),
          )
          .orderBy(desc(invoices.invoiceDate))
          .limit(1);
        if (candidates.length > 0) {
          matchedInvoiceId = candidates[0].id;
          matchedAt = new Date();
        }
      }

      if (existing.length === 0) {
        // INSERT
        await d.insert(algEstimates).values({
          externalId: est.externalId,
          customerName: est.customerName,
          customerPhone: est.customerPhone,
          vehicleInfo: est.vehicleInfo,
          serviceDescription: est.serviceDescription,
          estimatedAmount: est.estimatedAmount,
          estimateDate: est.estimateDate,
          matchedInvoiceId,
          matchedAt,
          source: "alg",
        });
        result.created++;
        if (matchedInvoiceId) result.matchedNow++;
        else result.unmatched++;
      } else {
        // UPDATE — preserve follow_up flags; refresh core fields;
        // only set matchedInvoiceId when previously null.
        const row = existing[0];
        const updates: Record<string, unknown> = {
          customerName: est.customerName,
          customerPhone: est.customerPhone,
          vehicleInfo: est.vehicleInfo,
          serviceDescription: est.serviceDescription,
          estimatedAmount: est.estimatedAmount,
          estimateDate: est.estimateDate,
        };
        if (!row.matchedInvoiceId && matchedInvoiceId) {
          updates.matchedInvoiceId = matchedInvoiceId;
          updates.matchedAt = matchedAt;
          result.matchedNow++;
        }
        await d.update(algEstimates).set(updates).where(eq(algEstimates.id, row.id));
        result.updated++;
        if (!row.matchedInvoiceId && !matchedInvoiceId) result.unmatched++;
      }
    } catch (err) {
      log.warn("upsertEstimates row failed", {
        externalId: est.externalId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Backfill match pass: for every existing alg_estimate where
 * matchedInvoiceId IS NULL, recheck whether an invoice has since appeared.
 * Runs inline after each sync, and is exported so a one-time backfill can
 * reach further back than the inline window.
 *
 * ★ IT WAS NOT DORMANT — IT RAN AND MATCHED NOTHING (fixed 2026-08-08).
 *
 * The phone predicate was `eq(invoices.customerPhone, est.customerPhone)` —
 * exact string equality — and the two tables store phones in different formats:
 * `alg_estimates` holds E.164 (`+11234567890`) while `invoices` holds whatever
 * the mirror wrote (`(216) 555-9999`, bare 10-digit). Those never compare equal,
 * so the pass executed on every sync and found nothing, which is indistinguishable
 * from "no matches exist" in every log and dashboard. Measured result: 5 matched
 * rows in the table's LIFETIME, all written by one backfill on 2026-05-07, and a
 * 1.1% match rate that nothing flagged for three months.
 *
 * The consequence was not cosmetic: `declinedWorkRecovery` reads
 * `matched_invoice_id IS NULL` as "the customer declined" and texts them. An
 * unmatched-because-unmatchable row is a customer who may have paid.
 *
 * Fixed with PHONE_MATCH_KEY_SQL + phoneMatchKey — the JS/SQL twins the rest of
 * the app already uses. `smsPerformance.ts` carries the same repair for the same
 * reason; this is not a fourth identity rule, it is the existing one finally
 * applied here. Read-only simulation before the change: raw equality would match
 * 1 row, canonical matches 30 ($20,364), and 171 distinct phones join instead of 17.
 */
export interface BackfillMatchOptions {
  /** How far back to look. Defaults to the inline 30d window. */
  sinceDays?: number;
  /** Report what WOULD match and write nothing. */
  dryRun?: boolean;
}

export interface BackfillMatchResult {
  matched: number;
  scanned: number;
  skippedNoPhone: number;
  dryRun: boolean;
  /** Populated on a dry run so the write can be reviewed before it happens. */
  preview: Array<{ estimateId: number; invoiceId: number; amountCents: number }>;
}

export async function backfillMatches(opts: BackfillMatchOptions = {}): Promise<BackfillMatchResult> {
  const dryRun = opts.dryRun ?? false;
  const empty: BackfillMatchResult = { matched: 0, scanned: 0, skippedNoPhone: 0, dryRun, preview: [] };
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return empty;

  const { algEstimates, invoices } = await import("../../drizzle/schema");
  const { PHONE_MATCH_KEY_SQL, phoneMatchKey } = await import("../lib/phoneIdentity");
  const since = new Date(Date.now() - (opts.sinceDays ?? 30) * 24 * 60 * 60 * 1000);

  const unmatched = await d
    .select({
      id: algEstimates.id,
      customerPhone: algEstimates.customerPhone,
      estimatedAmount: algEstimates.estimatedAmount,
      estimateDate: algEstimates.estimateDate,
    })
    .from(algEstimates)
    .where(and(isNull(algEstimates.matchedInvoiceId), gte(algEstimates.estimateDate, since)))
    .limit(200);

  let matched = 0;
  let skippedNoPhone = 0;
  const preview: BackfillMatchResult["preview"] = [];

  for (const est of unmatched) {
    // The JS twin. Returns null below ten digits — a truncation or placeholder
    // identifies nobody, and matching one would be a guess.
    const key = phoneMatchKey(est.customerPhone);
    if (!key) {
      skippedNoPhone++;
      continue;
    }
    const low = Math.floor(est.estimatedAmount * 0.9);
    const high = Math.ceil(est.estimatedAmount * 1.1);
    const upperDate = new Date(est.estimateDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const candidates = await d
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          // The SQL twin, normalising the stored column to the same last-10
          // digits the JS side produced. Same pattern as smsPerformance.ts.
          sql`${sql.raw(PHONE_MATCH_KEY_SQL("customerPhone"))} = ${key}`,
          gte(invoices.totalAmount, low),
          lte(invoices.totalAmount, high),
          gte(invoices.invoiceDate, est.estimateDate),
          lte(invoices.invoiceDate, upperDate),
        ),
      )
      .limit(1);
    if (candidates.length > 0) {
      if (dryRun) {
        preview.push({ estimateId: est.id, invoiceId: candidates[0].id, amountCents: est.estimatedAmount });
      } else {
        await d
          .update(algEstimates)
          .set({ matchedInvoiceId: candidates[0].id, matchedAt: new Date() })
          .where(eq(algEstimates.id, est.id));
      }
      matched++;
    }
  }

  log.info("estimate backfill match pass", {
    scanned: unmatched.length,
    matched,
    skippedNoPhone,
    dryRun,
    sinceDays: opts.sinceDays ?? 30,
  });
  return { matched, scanned: unmatched.length, skippedNoPhone, dryRun, preview };
}

// ─── PUBLIC ENTRYPOINT ─────────────────────────────────

/**
 * Run one full estimate mirror cycle.
 * MUST be wrapped by runIfAdminActive() in the scheduler.
 * Safe to call manually for force-sync from admin UI.
 */
export async function runEstimateMirror(): Promise<{ recordsProcessed: number; details: string }> {
  const start = Date.now();
  const token = await authenticate();
  if (!token) {
    consecutiveEstimateFailures++;
    return {
      recordsProcessed: 0,
      details: `AUTH FAILED (consecutive: ${consecutiveEstimateFailures})`,
    };
  }

  const raw = await fetchEstimates(token);
  if (raw.length === 0) {
    consecutiveEstimateFailures++;
    return {
      recordsProcessed: 0,
      details: `No estimates returned (consecutive: ${consecutiveEstimateFailures})`,
    };
  }

  // Deduplicate raw by externalId (defensive — shouldn't happen but ShopDriver
  // sometimes returns duplicates across concatenated pages)
  const seen = new Set<string>();
  const unique = raw.filter((e) => {
    if (seen.has(e.externalId)) return false;
    seen.add(e.externalId);
    return true;
  });

  const upsert = await upsertEstimates(unique);
  // ROS-093 · the backfill MUST cover the whole declined-recovery send window.
  // This called backfillMatches() with no options, so it used the 30-day
  // default while declinedWorkRecovery texts on a 60-day window — estimates
  // aged 31-60 days could never be matched, stayed "declined" forever, and the
  // 30-day touch fired precisely where the matcher had gone blind. Shared
  // constant so the two cannot drift apart again.
  const backfill = await backfillMatches({ sinceDays: DECLINED_RECOVERY_WINDOW_DAYS });
  const backfillMatched = backfill.matched;

  lastEstimateSync = new Date();
  consecutiveEstimateFailures = 0;
  const duration = Date.now() - start;

  const details = [
    `Estimates: ${upsert.created} new, ${upsert.updated} updated`,
    `Matched: ${upsert.matchedNow} now + ${backfillMatched} backfilled`,
    `Unmatched (declined): ${upsert.unmatched}`,
    `Duration: ${duration}ms`,
  ].join(" | ");

  log.info(`Estimate mirror complete: ${details}`);
  return {
    recordsProcessed: upsert.created + upsert.updated,
    details,
  };
}

/**
 * Summary counters for admin dashboard / stats endpoints.
 * Cheap aggregate read from alg_estimates.
 */
export async function getEstimateSyncStatus(): Promise<{
  lastSync: string | null;
  totalEstimates: number;
  unmatchedCount: number;
  unmatchedValue: number;
  consecutiveFailures: number;
}> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) {
    return {
      lastSync: lastEstimateSync?.toISOString() || null,
      totalEstimates: 0,
      unmatchedCount: 0,
      unmatchedValue: 0,
      consecutiveFailures: consecutiveEstimateFailures,
    };
  }
  const { algEstimates } = await import("../../drizzle/schema");
  const totalRows = await d
    .select({ c: sql<number>`COUNT(*)` })
    .from(algEstimates);
  const unmatchedRows = await d
    .select({
      c: sql<number>`COUNT(*)`,
      v: sql<number>`COALESCE(SUM(${algEstimates.estimatedAmount}), 0)`,
    })
    .from(algEstimates)
    .where(isNull(algEstimates.matchedInvoiceId));
  return {
    lastSync: lastEstimateSync?.toISOString() || null,
    totalEstimates: Number(totalRows[0]?.c || 0),
    unmatchedCount: Number(unmatchedRows[0]?.c || 0),
    unmatchedValue: Number(unmatchedRows[0]?.v || 0),
    consecutiveFailures: consecutiveEstimateFailures,
  };
}
