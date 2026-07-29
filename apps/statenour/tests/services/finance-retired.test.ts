import { describe, it, expect } from "vitest";
import { parseCSV, syncTransactions } from "@/lib/services/finance";

/**
 * Wiring-audit regression pins (2026-07-28 late). The old stub returned
 * {imported: 0, skipped: N} and the UI rendered "Successfully synced!"
 * over a void for five weeks. A retired capability must REFUSE loudly —
 * this test makes a future re-stub a red suite, not a silent lie.
 */
describe("finance service — retired sync refuses loudly", () => {
  it("syncTransactions throws instead of pretending", async () => {
    await expect(
      syncTransactions([
        { date: new Date(), description: "test", amountCents: 100 } as never,
      ]),
    ).rejects.toThrow(/retired/i);
  });

  it("parseCSV (still-live parser) keeps working", () => {
    const rows = parseCSV("Date,Description,Amount\n2026-07-01,Coffee,-4.50");
    expect(Array.isArray(rows)).toBe(true);
  });
});
