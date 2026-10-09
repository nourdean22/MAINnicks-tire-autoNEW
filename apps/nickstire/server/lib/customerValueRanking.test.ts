import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../db", () => ({ getDb: async () => ({ execute: h.execute }) }));

import { getCustomerValueReferenceRanking, rankCustomerValueHistories } from "./customerValueRanking";

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

  // invoiceDate is stored in shop time: a date-only ALG ticket is its day's 00:00, which the
  // driver reads on a UTC server as 00:00Z, i.e. 20:00 the evening before in New York.
  const SAME_DAY_MIXED = [
    { customerId: 1, invoiceDate: new Date("2026-08-01T00:00:00Z"), totalAmount: 10000 }, // date-only
    { customerId: 1, invoiceDate: new Date("2026-08-01T14:00:00Z"), totalAmount: 5000 }, // timed
    { customerId: 1, invoiceDate: new Date("2026-09-01T14:00:00Z"), totalAmount: 20000 },
  ];

  it("groups by the stored shop day when the reader supplies it: a date-only and a timed ticket of one day are one period", () => {
    const withDay = SAME_DAY_MIXED.map((r) => ({ ...r, shopDay: r.invoiceDate.toISOString().slice(0, 10) }));
    expect(rankCustomerValueHistories(withDay, NOW)[0]).toMatchObject({ purchaseDays: 2, frequency: 1 });
    // Control: re-deriving the day from the driver's Date in New York time splits that day in two.
    expect(rankCustomerValueHistories(SAME_DAY_MIXED, NOW)[0]).toMatchObject({ purchaseDays: 3, frequency: 2 });
  });

  it("the reader takes the shop day from SQL, as stored", async () => {
    h.execute.mockResolvedValueOnce([
      SAME_DAY_MIXED.map((r) => ({
        customerId: r.customerId,
        invoiceDate: r.invoiceDate,
        shopDay: r.invoiceDate.toISOString().slice(0, 10),
        totalAmount: r.totalAmount,
      })),
      [],
    ]);
    const result = await getCustomerValueReferenceRanking(25, NOW);
    const query = JSON.stringify(h.execute.mock.calls[0]![0]);
    expect(query).toContain("DATE_FORMAT(invoiceDate, '%Y-%m-%d') AS shopDay");
    expect(query).not.toContain("CONVERT_TZ");
    expect(result.rows[0]).toMatchObject({ customerId: 1, purchaseDays: 2 });
  });

  it("contains no customer-contact side effect imports or send calls", () => {
    const here = fileURLToPath(new URL("./customerValueRanking.ts", import.meta.url));
    const source = readFileSync(here, "utf8");
    expect(source).not.toMatch(/sendSms|sendOutreach|placeVapiOutboundCall|createCampaign|dispatchSms/);
    expect(source).toContain("rankingOnly: true");
    expect(source).toContain("external-cdnow-reference-not-shop-fitted");
  });
});
