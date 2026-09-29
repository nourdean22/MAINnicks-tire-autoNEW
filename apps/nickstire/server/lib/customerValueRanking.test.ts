import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rankCustomerValueHistories } from "./customerValueRanking";

const NOW = new Date("2026-09-29T16:00:00.000Z");

describe("Q-27 customer value reference ranking", () => {
  it("collapses multiple paid invoices on the same shop day into one purchase period", () => {
    const rows = rankCustomerValueHistories(
      [
        { customerId: 1, invoiceDate: new Date("2026-08-01T14:00:00Z"), totalAmount: 10000 },
        { customerId: 1, invoiceDate: new Date("2026-08-01T18:00:00Z"), totalAmount: 5000 },
        { customerId: 1, invoiceDate: new Date("2026-09-01T14:00:00Z"), totalAmount: 20000 },
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customerId: 1,
      purchaseDays: 2,
      frequency: 1,
      repeatAverageCents: 20000,
    });
  });

  it("ignores future, zero, and invalid-money rows instead of turning them into customer evidence", () => {
    const rows = rankCustomerValueHistories(
      [
        { customerId: 1, invoiceDate: new Date("2026-09-01T14:00:00Z"), totalAmount: 10000 },
        { customerId: 1, invoiceDate: new Date("2026-10-01T14:00:00Z"), totalAmount: 50000 },
        { customerId: 1, invoiceDate: new Date("2026-09-10T14:00:00Z"), totalAmount: 0 },
      ],
      NOW,
    );
    expect(rows[0]).toMatchObject({ purchaseDays: 1, frequency: 0 });
  });

  it("uses repeat purchase values, not first-purchase value, for Gamma-Gamma personal evidence", () => {
    const rows = rankCustomerValueHistories(
      [
        { customerId: 7, invoiceDate: new Date("2026-01-01T14:00:00Z"), totalAmount: 100000 },
        { customerId: 7, invoiceDate: new Date("2026-04-01T14:00:00Z"), totalAmount: 20000 },
        { customerId: 7, invoiceDate: new Date("2026-08-01T14:00:00Z"), totalAmount: 40000 },
      ],
      NOW,
    );
    expect(rows[0]?.repeatAverageCents).toBe(30000);
  });

  it("is deterministic for identical inputs and sorts by the reference score only", () => {
    const input = [
      { customerId: 1, invoiceDate: new Date("2025-12-01T14:00:00Z"), totalAmount: 10000 },
      { customerId: 1, invoiceDate: new Date("2026-09-20T14:00:00Z"), totalAmount: 45000 },
      { customerId: 2, invoiceDate: new Date("2025-12-01T14:00:00Z"), totalAmount: 10000 },
      { customerId: 2, invoiceDate: new Date("2026-03-01T14:00:00Z"), totalAmount: 15000 },
    ];
    const a = rankCustomerValueHistories(input, NOW);
    const b = rankCustomerValueHistories(input, NOW);
    expect(a).toEqual(b);
    expect(a[0]!.rankingScoreCents).toBeGreaterThanOrEqual(a[1]!.rankingScoreCents);
  });

  it("contains no customer-contact side effect imports or send calls", () => {
    const here = fileURLToPath(new URL("./customerValueRanking.ts", import.meta.url));
    const source = readFileSync(here, "utf8");
    expect(source).not.toMatch(/sendSms|sendOutreach|placeVapiOutboundCall|createCampaign|dispatchSms/);
    expect(source).toContain("rankingOnly: true");
    expect(source).toContain("external-cdnow-reference-not-shop-fitted");
  });
});
