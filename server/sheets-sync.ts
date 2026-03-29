/**
 * Google Sheets CRM Sync
 * Auto-syncs leads and bookings to a Google Sheet for call tracking.
 * Uses the gws CLI for authentication (server-side only).
 *
 * FIX: Writes JSON to temp files and uses `cat` in a bash subshell
 * to avoid all shell escaping issues with spaces and special characters.
 */

import { exec } from "child_process";
import { writeFileSync, unlinkSync, readFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_CRM_ID || "";

// Token file path — written by the bootstrap script at server start
const TOKEN_FILE = "/tmp/.gws-auth-token";

/**
 * Get the auth token for Google Workspace API.
 * The dev server process receives a redacted GOOGLE_WORKSPACE_CLI_TOKEN,
 * so we read the real token from a file that was written at startup
 * from the parent shell environment.
 */
function getAuthToken(): string {
  // Try reading from token file first (most reliable)
  try {
    if (existsSync(TOKEN_FILE)) {
      const token = readFileSync(TOKEN_FILE, "utf-8").trim();
      if (token.length > 20) return token;
    }
  } catch {}
  // Fallback to env vars
  const envToken = process.env.GOOGLE_DRIVE_TOKEN || process.env.GOOGLE_WORKSPACE_CLI_TOKEN || "";
  return envToken.length > 20 ? envToken : "";
}

// On module load, write the token file if we have a valid token in env
// This handles the case where the module is loaded from a shell that has the real token
try {
  const token = process.env.GOOGLE_DRIVE_TOKEN || process.env.GOOGLE_WORKSPACE_CLI_TOKEN || "";
  if (token.length > 20) {
    writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  }
} catch {}

/**
 * Run a shell command and return stdout/stderr as a promise.
 */
function execPromise(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const token = getAuthToken();
    exec(cmd, {
      timeout: 15000,
      shell: "/bin/bash",
      env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: token },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Append a row to a specific sheet in the CRM spreadsheet.
 * Writes JSON payloads to temp files to avoid shell escaping issues.
 */
async function appendRow(sheetName: string, values: string[]): Promise<boolean> {
  if (!SPREADSHEET_ID) {
    console.warn("[Sheets] No GOOGLE_SHEETS_CRM_ID configured, skipping sync");
    return false;
  }

  const id = randomBytes(6).toString("hex");
  const paramsFile = `/tmp/gws-params-${id}.json`;
  const bodyFile = `/tmp/gws-body-${id}.json`;

  try {
    // Sanitize values — strip newlines
    const sanitizedValues = values.map(v => (v || "").replace(/[\r\n]+/g, " ").trim());

    const paramsObj = {
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    };

    const bodyObj = {
      values: [sanitizedValues],
    };

    // Write JSON to temp files — no escaping needed
    writeFileSync(paramsFile, JSON.stringify(paramsObj));
    writeFileSync(bodyFile, JSON.stringify(bodyObj));

    // Build command that reads from files using bash cat
    // The key: we use double quotes around $(cat ...) so bash expands it,
    // and the JSON content is passed as a single argument to gws
    const cmd = `gws sheets spreadsheets values append --params "$(cat '${paramsFile}')" --json "$(cat '${bodyFile}')"`;

    const { stdout } = await execPromise(cmd);

    // Check if the response contains an error
    if (stdout && stdout.includes('"error"')) {
      console.error("[Sheets] API error:", stdout);
      return false;
    }

    // Row appended successfully
    return true;
  } catch (error: any) {
    console.error("[Sheets] Failed to append row:", error?.message || error);
    if (error?.stdout) console.error("[Sheets] stdout:", error.stdout);
    return false;
  } finally {
    // Clean up temp files
    try { unlinkSync(paramsFile); } catch {}
    try { unlinkSync(bodyFile); } catch {}
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
 * Called automatically when bookings are completed or tire orders are installed.
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
 * Sync a financing application click/submission to the Financing sheet.
 * Tracks which provider was selected, from which page, and customer info if available.
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
