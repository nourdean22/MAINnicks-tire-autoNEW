import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

describe("Google Sheets CRM Sync", () => {
  const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_CRM_ID || "";
  const AUTH_TOKEN =
    process.env.GOOGLE_DRIVE_TOKEN ||
    process.env.GOOGLE_WORKSPACE_CLI_TOKEN ||
    "";

  it("should have GOOGLE_SHEETS_CRM_ID configured", () => {
    expect(SPREADSHEET_ID).toBeTruthy();
  });

  it("should have a valid auth token available", () => {
    expect(AUTH_TOKEN.length).toBeGreaterThan(20);
  });

  it("should be able to read the Leads sheet via gws CLI", () => {
    const params = JSON.stringify({
      spreadsheetId: SPREADSHEET_ID,
      range: "Leads!A1:A1",
    });
    const result = execSync(
      `gws sheets spreadsheets values get --params '${params}'`,
      {
        encoding: "utf-8",
        timeout: 15000,
        env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: AUTH_TOKEN },
      }
    );
    const data = JSON.parse(result);
    expect(data.values).toBeDefined();
    expect(data.values[0][0]).toBe("Date");
  });

  it("should be able to read the Bookings sheet via gws CLI", () => {
    const params = JSON.stringify({
      spreadsheetId: SPREADSHEET_ID,
      range: "Bookings!A1:A1",
    });
    const result = execSync(
      `gws sheets spreadsheets values get --params '${params}'`,
      {
        encoding: "utf-8",
        timeout: 15000,
        env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: AUTH_TOKEN },
      }
    );
    const data = JSON.parse(result);
    expect(data.values).toBeDefined();
    expect(data.values[0][0]).toBe("Date");
  });
});
