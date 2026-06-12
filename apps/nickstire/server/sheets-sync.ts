/**
 * Google Sheets CRM Sync
 * Auto-syncs leads, bookings, invoices, callbacks to a Google Sheet.
 *
 * Uses googleapis SDK with Google Service Account auth.
 * This works in ANY environment (Railway, Vercel, local) — no CLI dependency.
 *
 * Required env vars:
 *   GOOGLE_SHEETS_CRM_ID  — Spreadsheet ID from the URL
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL — Service account email
 *   GOOGLE_SERVICE_ACCOUNT_KEY   — Private key (PEM format, \n escaped)
 *
 * Setup: Share the spreadsheet with the service account email as Editor.
 */

import { createLogger } from "./lib/logger";

import { BUSINESS } from "@shared/business";
import { normalizePathname } from "@shared/attribution";
const log = createLogger("sheets-sync");

// ─── ATTRIBUTION COLUMNS (sheets-attribution wave 2026-06) ───────────
// Append-only attribution tail added to the Leads / Bookings / Callbacks
// rows so the owner's working CRM can answer "which source/campaign/page
// produced this" without opening the app.
//
// RULES (operator-approved):
//  - APPEND-ONLY: these cells go AFTER every existing column; existing
//    column positions and any owner formulas are untouched.
//  - ALWAYS 5 CELLS: every row appends exactly these five values (blank
//    when unknown) so columns stay aligned across all submit paths —
//    including paths with no web attribution (SMS bot, after-hours
//    emergency), which write honest blanks.
//  - TRUTHFUL: values come only from fields already captured/stored
//    (lead/booking/callback input -> DB columns). Nothing is invented;
//    blank is better than fake. Landing Page is pathname-normalized
//    (the stored value is the full href; pathname keeps the column
//    readable and stops UTM variants fragmenting it).
//  - NON-SENSITIVE: utm labels, a pathname, and the referrer URL only.
//    No tokens, no user agents, no raw payloads, no PII beyond what the
//    CRM rows already carry by design.
//
// Header labels for the owner to paste in row 1 of each tab (exact
// columns are in docs/audits/NICKSTIRE-SHEETS-ATTRIBUTION-AUDIT.md):
export const SHEET_ATTRIBUTION_HEADERS = [
  "UTM Source",
  "UTM Medium",
  "UTM Campaign",
  "Landing Page",
  "Referrer",
] as const;

export interface SheetAttribution {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  landingPage?: string | null;
  referrer?: string | null;
}

/**
 * Build the fixed 5-cell attribution tail for a sheet row.
 * Pure + exported for unit tests. Always returns exactly 5 strings.
 */
export function attributionCells(a?: SheetAttribution | null): string[] {
  return [
    a?.utmSource || "",
    a?.utmMedium || "",
    a?.utmCampaign || "",
    normalizePathname(a?.landingPage) || "",
    a?.referrer || "",
  ];
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_CRM_ID || "";

// Lazy-loaded googleapis client (saves ~15MB until first use)
let _sheets: any = null;

async function getSheetsClient(): Promise<any> {
  if (_sheets) return _sheets;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!email || !rawKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_KEY");
  }

  const privateKey = rawKey.replace(/\\n/g, "\n");

  const { google } = await import("googleapis");
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

/**
 * Append a row to a specific sheet in the CRM spreadsheet.
 * Retries once on auth failure (token refresh).
 */
async function appendRow(sheetName: string, values: string[], retried = false): Promise<boolean> {
  if (!SPREADSHEET_ID) {
    log.warn("No GOOGLE_SHEETS_CRM_ID configured, skipping sync");
    return false;
  }

  try {
    const sheets = await getSheetsClient();
    const sanitizedValues = values.map(v => (v || "").replace(/[\r\n]+/g, " ").trim());

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [sanitizedValues],
      },
    });

    return true;
  } catch (error: any) {
    // On first auth error, reset client and retry once
    if (!retried && (error?.code === 401 || error?.code === 403)) {
      log.warn("Sheets auth failed, retrying with fresh client");
      _sheets = null;
      return appendRow(sheetName, values, true);
    }
    // v1.7 audit fix · 429 (quota exceeded) used to fall through to
    // log.error and return false — silent CRM data drops at scale.
    // Now: backoff retry once with a short jitter sleep. Google's
    // per-minute quota bucket clears in ~60s.
    if (!retried && error?.code === 429) {
      log.warn("Sheets quota exceeded (429), backing off 30s + retry once");
      await new Promise((r) => setTimeout(r, 30_000 + Math.random() * 5_000));
      return appendRow(sheetName, values, true);
    }
    // Missing tab is an OPERATOR SETUP problem, not a transient failure —
    // say exactly what to do instead of a generic append error. Fail-soft:
    // the caller's row is dropped (and logged), the DB record is unaffected.
    if (isMissingSheetTabError(error)) {
      log.error(
        `Sheet tab "${sheetName}" does not exist in the CRM spreadsheet — ` +
        `row dropped (DB record unaffected). FIX: open the spreadsheet ` +
        `(GOOGLE_SHEETS_CRM_ID), add a tab named exactly "${sheetName}", ` +
        `and paste the header row into row 1` +
        (sheetName === TIRE_ORDER_SHEET_TAB ? ` (TIRE_ORDER_SHEET_HEADERS in server/sheets-sync.ts)` : "") +
        `. Sync resumes automatically on the next order.`,
      );
      return false;
    }
    log.error(`Failed to append row to ${sheetName}:`, {
      error: error?.message || String(error),
      code: error?.code,
    });
    return false;
  }
}

/**
 * Sync a new lead to the Leads sheet.
 */
export async function syncLeadToSheet(lead: {
  name: string;
  phone: string;
  email?: string | null;
  vehicle?: string | null;
  problem?: string | null;
  source: string;
  urgencyScore: number;
  urgencyReason?: string | null;
  recommendedService?: string | null;
} & SheetAttribution): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
  return appendRow("Leads", [
    now,
    lead.name,
    lead.phone,
    lead.email || "",
    lead.vehicle || "",
    lead.problem || "",
    lead.source,
    String(lead.urgencyScore),
    lead.urgencyReason || "",
    lead.recommendedService || "",
    "New",
    "No",
    "",
    "",
    // attribution tail (cols O-S) — always 5 cells, blank when unknown
    ...attributionCells(lead),
  ]);
}

/**
 * Sync a new booking to the Bookings sheet.
 */
export async function syncBookingToSheet(booking: {
  name: string;
  phone: string;
  email?: string | null;
  service: string;
  vehicle?: string | null;
  preferredDate?: string | null;
  preferredTime: string;
  message?: string | null;
} & SheetAttribution): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
  return appendRow("Bookings", [
    now,
    booking.name,
    booking.phone,
    booking.email || "",
    booking.service,
    booking.vehicle || "",
    booking.preferredDate || "Flexible",
    booking.preferredTime,
    booking.message || "",
    "New",
    "No",
    "",
    // attribution tail (cols M-Q) — always 5 cells, blank when unknown
    ...attributionCells(booking),
  ]);
}

/**
 * Check if the Google Sheets CRM is configured and accessible.
 */
export function isSheetConfigured(): boolean {
  return !!SPREADSHEET_ID;
}

export function getSpreadsheetUrl(): string {
  if (!SPREADSHEET_ID) return "";
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
}

/**
 * Sync a new callback request to the Callbacks sheet.
 */
export async function syncCallbackToSheet(callback: {
  name: string;
  phone: string;
  reason?: string | null;
  sourcePage?: string | null;
} & SheetAttribution): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
  return appendRow("Callbacks", [
    now,
    callback.name,
    callback.phone,
    callback.reason || "",
    callback.sourcePage || "",
    "New",
    "No",
    "",
    "",
    "",
    // attribution tail (cols K-O) — always 5 cells, blank when unknown
    ...attributionCells(callback),
  ]);
}

/** Tab name syncTireOrderToSheet appends to — must exist in the CRM spreadsheet. */
export const TIRE_ORDER_SHEET_TAB = "Tire Orders";

/**
 * Row-1 headers for the "Tire Orders" tab, in exact column order —
 * MUST stay aligned with tireOrderRow below (unit-tested). The operator
 * pastes these into row 1 of the tab; the sync itself only ever appends
 * data rows and never writes headers (append-only, non-destructive).
 */
export const TIRE_ORDER_SHEET_HEADERS = [
  "Order #",
  "Date",
  "Status",
  "Customer Name",
  "Phone",
  "Email",
  "Vehicle",
  "Tire Brand",
  "Tire Model",
  "Tire Size",
  "Qty",
  "Price/Tire",
  "Install Fee",
  "Total",
  "Customer Notes",
  "Gateway Ref",
  "Expected Delivery",
  "Installation Date",
  "Payment Status",
  ...SHEET_ATTRIBUTION_HEADERS,
] as const;

/**
 * Google's values.append against a tab that doesn't exist fails with
 * 400 "Unable to parse range: '<tab>'!A:Z". Pure + exported so the
 * detection is unit-testable.
 */
export function isMissingSheetTabError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
  return /unable to parse range/i.test(msg);
}

/**
 * Build the "Tire Orders" sheet row. Pure + exported for unit tests.
 * Columns A-R mirror the tab's original layout (order#, date, status,
 * customer, tire, money, notes, then fulfillment cells the shop fills
 * in by hand), followed by append-only additions: Payment Status + the
 * standard 5-cell attribution tail. Blank is better than fake — the
 * fulfillment cells start empty.
 */
export function tireOrderRow(
  order: {
    orderNumber: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string | null;
    vehicleInfo?: string | null;
    tireBrand: string;
    tireModel: string;
    tireSize: string;
    quantity: number;
    /** dollars */
    pricePerTire: number;
    /** dollars */
    totalAmount: number;
    customerNotes?: string | null;
    status: string;
    paymentStatus?: string | null;
  } & SheetAttribution,
  timestamp: string,
): string[] {
  return [
    order.orderNumber,
    timestamp,
    order.status.charAt(0).toUpperCase() + order.status.slice(1),
    order.customerName,
    order.customerPhone,
    order.customerEmail || "",
    order.vehicleInfo || "",
    order.tireBrand,
    order.tireModel,
    order.tireSize,
    String(order.quantity),
    `$${order.pricePerTire.toFixed(2)}`,
    "$0.00 (Included)", // install package — baked into the tire price
    `$${order.totalAmount.toFixed(2)}`,
    order.customerNotes || "",
    "", // Gateway Ref — shop fills after ordering from D&K
    "", // Expected Delivery
    "", // Installation Date
    order.paymentStatus || "unpaid",
    // attribution tail — always 5 cells, blank when unknown
    ...attributionCells(order),
  ];
}

/**
 * Sync a new tire order to the "Tire Orders" sheet.
 * Replaces the dead Manus-era rclone path (it read
 * /home/ubuntu/.gdrive-rclone.ini, which does not exist on Railway) —
 * the service-account auth used by every other sync works anywhere.
 */
export async function syncTireOrderToSheet(
  order: Parameters<typeof tireOrderRow>[0],
): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
  return appendRow(TIRE_ORDER_SHEET_TAB, tireOrderRow(order, now));
}

/**
 * Sync an invoice to the Invoices sheet.
 */
export async function syncInvoiceToSheet(invoice: {
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  vehicleInfo?: string | null;
  serviceDescription: string;
  laborHours: number;
  laborRate: number;
  laborCost: number;
  partsCost: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  source: string;
  orderRef?: string | null;
  notes?: string | null;
}): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
  return appendRow("Invoices", [
    invoice.invoiceNumber,
    now,
    invoice.customerName,
    invoice.customerPhone,
    invoice.vehicleInfo || "",
    invoice.serviceDescription,
    String(invoice.laborHours),
    `$${invoice.laborRate.toFixed(2)}`,
    `$${invoice.laborCost.toFixed(2)}`,
    `$${invoice.partsCost.toFixed(2)}`,
    `$${invoice.taxAmount.toFixed(2)}`,
    `$${invoice.totalAmount.toFixed(2)}`,
    invoice.paymentMethod,
    invoice.paymentStatus,
    invoice.source,
    invoice.orderRef || "",
    invoice.notes || "",
  ]);
}

/**
 * Sync a financing application to the Financing sheet.
 */
export async function syncFinancingToSheet(application: {
  provider: string;
  providerType: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  sourcePage: string;
  estimatedAmount?: string | null;
  status: string;
  notes?: string | null;
} & SheetAttribution): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
  return appendRow("Financing", [
    now,
    application.provider,
    application.providerType,
    application.customerName || "",
    application.customerPhone || "",
    application.customerEmail || "",
    application.sourcePage,
    application.estimatedAmount || "",
    application.status,
    application.notes || "",
    // attribution tail (cols K-O) — always 5 cells, blank when unknown
    // (admin counter-logged applications carry no web attribution).
    ...attributionCells(application),
  ]);
}

/**
 * Sync a work order to the WorkOrders sheet.
 */
export async function syncWorkOrderToSheet(wo: {
  orderNumber: string;
  customerName?: string | null;
  customerPhone?: string | null;
  vehicleYear?: number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  serviceDescription?: string | null;
  status: string;
  priority?: string | null;
  assignedTech?: string | null;
  source?: string | null;
  estimatedTotal?: number | null;
}): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
  const vehicle = [wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ");
  return appendRow("WorkOrders", [
    now,
    wo.orderNumber,
    wo.customerName || "",
    wo.customerPhone || "",
    vehicle,
    wo.serviceDescription || "",
    wo.status,
    wo.priority || "normal",
    wo.assignedTech || "",
    wo.source || "",
    wo.estimatedTotal ? `$${(wo.estimatedTotal / 100).toFixed(2)}` : "",
  ]);
}

/**
 * Sync dashboard metrics to the Dashboard sheet (called by cron).
 */
export async function syncDashboardToSheet(metrics: {
  date: string;
  time: string;
  bookings: number;
  leads: number;
  callbacks: number;
  invoices: number;
  revenue: number;
}): Promise<boolean> {
  return appendRow("Dashboard", [
    metrics.date,
    metrics.time,
    String(metrics.bookings),
    String(metrics.leads),
    String(metrics.callbacks),
    String(metrics.invoices),
    `$${metrics.revenue}`,
  ]);
}

/**
 * Upsert a row in a sheet where Column A matches the given ID.
 * If found, updates the row. Otherwise appends it.
 */
async function upsertRow(sheetName: string, id: string, values: string[], retried = false): Promise<boolean> {
  if (!SPREADSHEET_ID) {
    log.warn("No GOOGLE_SHEETS_CRM_ID configured, skipping sync");
    return false;
  }

  try {
    const sheets = await getSheetsClient();
    const sanitizedValues = values.map(v => (v || "").replace(/[\r\n]+/g, " ").trim());

    // 1. Fetch all values in Column A
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:A`,
    });

    const rows = res.data.values || [];
    const rowIndex = rows.findIndex((row: string[]) => row[0] === id);

    if (rowIndex !== -1) {
      // 2. Update existing row (remember 1-based index)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A${rowIndex + 1}:Z${rowIndex + 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [sanitizedValues],
        },
      });
      return true;
    } else {
      // 3. Append new row
      return appendRow(sheetName, values);
    }
  } catch (error: any) {
    if (!retried && (error?.code === 401 || error?.code === 403)) {
      log.warn("Sheets auth failed, retrying with fresh client");
      _sheets = null;
      return upsertRow(sheetName, id, values, true);
    }
    if (!retried && error?.code === 429) {
      log.warn("Sheets quota exceeded (429), backing off 30s + retry once");
      await new Promise((r) => setTimeout(r, 30_000 + Math.random() * 5_000));
      return upsertRow(sheetName, id, values, true);
    }
    if (isMissingSheetTabError(error)) {
      log.error(
        `Sheet tab "${sheetName}" does not exist in the CRM spreadsheet. ` +
        `FIX: open the spreadsheet, add tab "${sheetName}".`
      );
      return false;
    }
    log.error(`Failed to upsert row to ${sheetName}:`, {
      error: error?.message || String(error),
      code: error?.code,
    });
    return false;
  }
}

/**
 * Fetch all rows from a sheet.
 */
async function fetchRows(sheetName: string, retried = false): Promise<string[][]> {
  if (!SPREADSHEET_ID) {
    log.warn("No GOOGLE_SHEETS_CRM_ID configured, skipping fetch");
    return [];
  }

  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
    });
    return res.data.values || [];
  } catch (error: any) {
    if (!retried && (error?.code === 401 || error?.code === 403)) {
      log.warn("Sheets auth failed, retrying with fresh client");
      _sheets = null;
      return fetchRows(sheetName, true);
    }
    if (!retried && error?.code === 429) {
      log.warn("Sheets quota exceeded (429), backing off 30s + retry once");
      await new Promise((r) => setTimeout(r, 30_000 + Math.random() * 5_000));
      return fetchRows(sheetName, true);
    }
    if (isMissingSheetTabError(error)) {
      log.error(`Sheet tab "${sheetName}" does not exist in the CRM spreadsheet.`);
      return [];
    }
    log.error(`Failed to fetch rows from ${sheetName}:`, {
      error: error?.message || String(error),
      code: error?.code,
    });
    return [];
  }
}

/**
 * Sync a Reel draft to Google Sheets.
 */
export async function syncReelDraftToSheet(id: string, topic: string, briefJson: string): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
  return upsertRow("Reels Drafts", id, [id, topic, now, briefJson]);
}

/**
 * Sync a Carousel draft to Google Sheets.
 */
export async function syncCarouselDraftToSheet(id: string, topic: string, briefJson: string): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
  return upsertRow("Carousel Drafts", id, [id, topic, now, briefJson]);
}

/**
 * Fetch all Reel drafts from Google Sheets.
 */
export async function fetchReelDraftsFromSheet(): Promise<any[]> {
  const rows = await fetchRows("Reels Drafts");
  if (rows.length <= 1) return []; // Ignore header row
  const drafts: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[3]) {
      try {
        drafts.push(JSON.parse(row[3]));
      } catch (e) {
        log.error("Failed to parse Reel draft JSON", { id: row[0], error: e });
      }
    }
  }
  return drafts;
}

/**
 * Fetch all Carousel drafts from Google Sheets.
 */
export async function fetchCarouselDraftsFromSheet(): Promise<any[]> {
  const rows = await fetchRows("Carousel Drafts");
  if (rows.length <= 1) return []; // Ignore header row
  const drafts: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[3]) {
      try {
        drafts.push(JSON.parse(row[3]));
      } catch (e) {
        log.error("Failed to parse Carousel draft JSON", { id: row[0], error: e });
      }
    }
  }
  return drafts;
}

/**
 * Sync a Reel log to Google Sheets.
 */
export async function syncReelLogToSheet(logData: {
  topic: string;
  verifiedFact: string;
  sources: string;
  driverConfusion: string;
  clevelandAngle: string;
  campaignKeyword: string;
  creativeTerritory: string;
  usefulAbsurdity: string;
  storyboardOutline: string;
  captionHook: string;
  instagramUrl: string;
  assetPaths: string;
  score: string;
  hashtags: string;
  avoidedRepeats: string;
  issues: string;
  insightsChecked: string;
  facebookCrossPostOff: string;
}): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
  return appendRow("Reels Log", [
    now,
    logData.topic,
    logData.verifiedFact,
    logData.sources,
    logData.driverConfusion,
    logData.clevelandAngle,
    logData.campaignKeyword,
    logData.creativeTerritory,
    logData.usefulAbsurdity,
    logData.storyboardOutline,
    logData.captionHook,
    logData.instagramUrl,
    logData.assetPaths,
    logData.score,
    logData.hashtags,
    logData.avoidedRepeats,
    logData.issues,
    logData.insightsChecked,
    logData.facebookCrossPostOff,
  ]);
}

/**
 * Sync a Carousel log to Google Sheets.
 */
export async function syncCarouselLogToSheet(logData: {
  topic: string;
  verifiedFact: string;
  sources: string;
  driverConfusion: string;
  clevelandAngle: string;
  campaignKeyword: string;
  creativeTerritory: string;
  usefulAbsurdity: string;
  storyboardOutline: string;
  captionHook: string;
  instagramUrl: string;
  assetPaths: string;
  score: string;
  hashtags: string;
  avoidedRepeats: string;
  issues: string;
  insightsChecked: string;
  facebookCrossPostOff: string;
}): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
  return appendRow("Carousel Log", [
    now,
    logData.topic,
    logData.verifiedFact,
    logData.sources,
    logData.driverConfusion,
    logData.clevelandAngle,
    logData.campaignKeyword,
    logData.creativeTerritory,
    logData.usefulAbsurdity,
    logData.storyboardOutline,
    logData.captionHook,
    logData.instagramUrl,
    logData.assetPaths,
    logData.score,
    logData.hashtags,
    logData.avoidedRepeats,
    logData.issues,
    logData.insightsChecked,
    logData.facebookCrossPostOff,
  ]);
}

/**
 * Fetch all Reel logs from Google Sheets.
 */
export async function fetchReelLogsFromSheet(): Promise<any[]> {
  const rows = await fetchRows("Reels Log");
  if (rows.length <= 1) return []; // Ignore header row
  return rows.slice(1).map(row => ({
    timestamp: row[0] || "",
    topic: row[1] || "",
    verifiedFact: row[2] || "",
    sources: row[3] || "",
    driverConfusion: row[4] || "",
    clevelandAngle: row[5] || "",
    campaignKeyword: row[6] || "",
    creativeTerritory: row[7] || "",
    usefulAbsurdity: row[8] || "",
    storyboardOutline: row[9] || "",
    captionHook: row[10] || "",
    instagramUrl: row[11] || "",
    assetPaths: row[12] || "",
    score: row[13] || "",
    hashtags: row[14] || "",
    avoidedRepeats: row[15] || "",
    issues: row[16] || "",
    insightsChecked: row[17] || "",
    facebookCrossPostOff: row[18] || "",
  }));
}

/**
 * Fetch all Carousel logs from Google Sheets.
 */
export async function fetchCarouselLogsFromSheet(): Promise<any[]> {
  const rows = await fetchRows("Carousel Log");
  if (rows.length <= 1) return []; // Ignore header row
  return rows.slice(1).map(row => ({
    timestamp: row[0] || "",
    topic: row[1] || "",
    verifiedFact: row[2] || "",
    sources: row[3] || "",
    driverConfusion: row[4] || "",
    clevelandAngle: row[5] || "",
    campaignKeyword: row[6] || "",
    creativeTerritory: row[7] || "",
    usefulAbsurdity: row[8] || "",
    storyboardOutline: row[9] || "",
    captionHook: row[10] || "",
    instagramUrl: row[11] || "",
    assetPaths: row[12] || "",
    score: row[13] || "",
    hashtags: row[14] || "",
    avoidedRepeats: row[15] || "",
    issues: row[16] || "",
    insightsChecked: row[17] || "",
    facebookCrossPostOff: row[18] || "",
  }));
}

