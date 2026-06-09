/**
 * Unit tests for deriveSheetsSyncHealth — the pure status mapper behind the
 * "Sheets Sync Health" card. Fixtures use ordinary error text only (no
 * token-shaped strings).
 */
import { describe, it, expect } from "vitest";
import {
  deriveSheetsSyncHealth,
  type SyncFailureRow,
} from "../pages/admin/siteHealth/sheetsSyncHealth";

const sheetsFail = (over: Partial<SyncFailureRow> = {}): SyncFailureRow => ({
  failureType: "sheets_sync",
  message: "Google Sheets API quota exceeded (HTTP 429)",
  resolved: false,
  createdAt: "2026-06-09T12:00:00.000Z",
  ...over,
});

describe("deriveSheetsSyncHealth", () => {
  it("returns 'unknown' when the feed has not loaded", () => {
    expect(deriveSheetsSyncHealth(undefined).status).toBe("unknown");
    expect(deriveSheetsSyncHealth(null).status).toBe("unknown");
    expect(deriveSheetsSyncHealth(null).lastFailure).toBeNull();
  });

  it("returns 'healthy' when there are no failures at all", () => {
    const r = deriveSheetsSyncHealth({ failures: [] });
    expect(r.status).toBe("healthy");
    expect(r.recentCount).toBe(0);
    expect(r.lastFailure).toBeNull();
  });

  it("ignores non-sheets failures (e.g. sms) → still healthy", () => {
    const r = deriveSheetsSyncHealth({
      failures: [{ failureType: "sms", message: "Twilio send failed", resolved: false, createdAt: "2026-06-09T12:00:00Z" }],
    });
    expect(r.status).toBe("healthy");
    expect(r.recentCount).toBe(0);
  });

  it("returns 'failing' on an unresolved sheets_sync failure", () => {
    const r = deriveSheetsSyncHealth({ failures: [sheetsFail()] });
    expect(r.status).toBe("failing");
    expect(r.unresolvedCount).toBe(1);
    expect(r.recentCount).toBe(1);
    expect(r.lastFailure?.message).toContain("quota exceeded");
    expect(r.lastFailure?.resolved).toBe(false);
  });

  it("returns 'warning' when sheets_sync failures exist but are all resolved", () => {
    const r = deriveSheetsSyncHealth({ failures: [sheetsFail({ resolved: true })] });
    expect(r.status).toBe("warning");
    expect(r.unresolvedCount).toBe(0);
    expect(r.recentCount).toBe(1);
  });

  it("is 'failing' if ANY sheets_sync failure is unresolved (mixed set)", () => {
    const r = deriveSheetsSyncHealth({
      failures: [
        sheetsFail({ resolved: false, createdAt: "2026-06-09T14:00:00Z", message: "newest unresolved" }),
        sheetsFail({ resolved: true, createdAt: "2026-06-09T10:00:00Z", message: "older resolved" }),
      ],
    });
    expect(r.status).toBe("failing");
    expect(r.recentCount).toBe(2);
    expect(r.unresolvedCount).toBe(1);
    // Feed is server-sorted desc → lastFailure is the first (most recent) row.
    expect(r.lastFailure?.message).toBe("newest unresolved");
  });
});
