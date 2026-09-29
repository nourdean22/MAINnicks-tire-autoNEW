/**
 * The Q-46 decision receipt, driven through the REAL activity ledger
 * (sanitizeSnapshot + recordActivity), with only the audit_log insert
 * captured. inspectionDecisionReceipt.test.ts mocks recordActivity wholesale,
 * so it asserts what the writer hands over, never what lands in the row.
 *
 * Review finding on #2782: the first version stored decisionAt as a date
 * string, and the ledger's free-text phone scrubber turned
 * "2026-09-29 17:30:00" into "•••2917:30:00". The time is now a number,
 * which the scrubber leaves alone.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("./db");

const h = vi.hoisted(() => ({
  executed: 0,
  logged: [] as Array<Record<string, unknown>>,
}));

vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({ end: async () => {} }) } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => ({
    execute: async () => {
      h.executed += 1;
      if (h.executed === 1) return [{ affectedRows: 1 }, []];
      return [[{
        inspectionId: 7,
        customerName: "Test Customer",
        vehicleInfo: "2015 Honda Civic",
        component: "Front brake pads",
        recommendedAction: "Replace front pads",
        estimatedCost: 450,
        // mysql2 can hand UNIX_TIMESTAMP back as a string; the receipt must cope.
        decidedAtEpoch: "1790688600",
      }], []];
    },
  }),
}));
vi.mock("./services/auditTrail", () => ({
  logAdminAction: async (row: Record<string, unknown>) => {
    h.logged.push(row);
  },
}));
vi.mock("./services/realtime", () => ({ emitToAdmin: () => {} }));
vi.mock("./services/telegram", () => ({ sendTelegram: async () => {} }));

const { decideInspectionItem } = await import("./db");

const savedUrl = process.env.DATABASE_URL;
beforeEach(() => {
  process.env.DATABASE_URL = "mysql://test:3306/db";
  h.executed = 0;
  h.logged = [];
});
afterAll(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
});

describe("decision receipt through the real ledger", () => {
  it("stores a decision time that parses back to the real instant", async () => {
    const res = await decideInspectionItem({ token: "a".repeat(32), itemId: 11, decision: "approved", shownCost: 450 });

    expect(res).toEqual({ ok: true });
    expect(h.logged).toHaveLength(1);
    const row = h.logged[0] as { action: string; actorType: string; afterJson: Record<string, unknown> };
    expect(row.action).toBe("inspection.item_decided");
    expect(row.actorType).toBe("public");
    const at = row.afterJson.decidedAtEpochMs;
    expect(typeof at).toBe("number");
    expect(new Date(at as number).toISOString()).toBe("2026-09-29T13:30:00.000Z");
    expect(row.afterJson).toMatchObject({ amountDollars: 450, amountShownDollars: 450, amountMatchesShown: true });
  });
});
