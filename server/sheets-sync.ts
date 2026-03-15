/**
 * Google Sheets CRM Sync
 * Auto-syncs leads and bookings to a Google Sheet for call tracking.
 * Uses the gws CLI for authentication (server-side only).
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_CRM_ID || "";

/**
 * Append a row to a specific sheet in the CRM spreadsheet.
 */
async function appendRow(sheetName: string, values: string[]): Promise<boolean> {
  if (!SPREADSHEET_ID) {
    console.warn("[Sheets] No GOOGLE_SHEETS_CRM_ID configured, skipping sync");
    return false;
  }

  try {
    const escapedValues = values.map(v => (v || "").replace(/"/g, '\\"'));
    const rowJson = JSON.stringify([escapedValues]);
    
    const cmd = `gws sheets spreadsheets values append --params '${JSON.stringify({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    })}' --json '{"values": ${rowJson}}'`;

    const { stdout, stderr } = await execAsync(cmd, { timeout: 15000 });
    
    if (stderr && !stdout) {
      console.error("[Sheets] Sync error:", stderr);
      return false;
    }
    
    console.log(`[Sheets] Row appended to ${sheetName}`);
    return true;
  } catch (error) {
    console.error("[Sheets] Failed to append row:", error);
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
