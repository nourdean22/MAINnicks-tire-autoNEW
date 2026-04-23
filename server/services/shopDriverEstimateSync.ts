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

async function fetchEstimates(token: string): Promise<RawEstimate[]> {
  // Endpoint probe order — different ShopDriver tenants expose different
  // names. The primary candidates came from SPA bundle inspection; we
  // fall back through a list until one returns JSON with items.
  const endpoints = [
    "/api/Estimate/listEstimates?pageNumber=1&pageSize=500",
    "/api/ticket/listEstimates?pageNumber=1&pageSize=500",
    "/api/Estimate/list?pageNumber=1&pageSize=500",
    "/api/Report/listEstimates?pageNumber=1&pageSize=500",
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

  log.warn("No estimate data returned from any endpoint");
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
 * matchedInvoiceId IS NULL AND estimateDate >= now - 30d, recheck whether
 * an invoice has since appeared. Runs inline after each sync — cheap given
 * the small unmatched window.
 */
async function backfillMatches(): Promise<number> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return 0;

  const { algEstimates, invoices } = await import("../../drizzle/schema");
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

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
  for (const est of unmatched) {
    if (!est.customerPhone) continue;
    const low = Math.floor(est.estimatedAmount * 0.9);
    const high = Math.ceil(est.estimatedAmount * 1.1);
    const upperDate = new Date(est.estimateDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    const candidates = await d
      .select({ id: invoices.id })
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
      .limit(1);
    if (candidates.length > 0) {
      await d
        .update(algEstimates)
        .set({ matchedInvoiceId: candidates[0].id, matchedAt: new Date() })
        .where(eq(algEstimates.id, est.id));
      matched++;
    }
  }
  return matched;
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
  const backfillMatched = await backfillMatches();

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
