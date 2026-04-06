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

const log = createLogger("sheets-sync");

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
  const auth = new google.auth.JWT(email, undefined, privateKey, [
    "https://www.googleapis.com/auth/spreadsheets",
  ]);

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
}): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
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
}): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
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
}): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
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
  ]);
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
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
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
}): Promise<boolean> {
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
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
  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
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
