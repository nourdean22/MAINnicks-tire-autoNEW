/**
 * 2026-10-02 currency audit: the admin UI divides cents by 100 exactly once everywhere; the
 * defects were at BOUNDARIES where integer cents left nickstire under dollar-looking names,
 * or dollars went into a cents column. Source assertions (gscAggregationSemantics style):
 * the failure guarded is a formula shipping wrong, which is visible in the text.
 */
import { describe, expect, it } from "vitest";
import { readCode } from "../testUtils/sourceAssertions";

describe("money leaving nickstire is labelled or converted", () => {
  it("/api/bridge/analytics (ChatGPT action) converts invoice cents to dollars and says so", () => {
    const c = readCode("server/_core/bridge-routes.ts");
    const start = c.indexOf("SUM(totalAmount) as totalRevenue");
    const handler = c.slice(start, c.indexOf("customerStats:", start) + 200);
    expect(handler).toContain('moneyUnit: "USD dollars"');
    expect(handler).toMatch(/withUsd\(\(stats[^)]*\)\?\.\[0\], \["totalRevenue", "totalLabor", "totalParts", "totalTax", "avgTicket"\]\)/);
    expect(handler).toContain('withUsd(m, ["revenue", "labor", "parts"])');
    expect(handler).toContain('withUsd(p, ["revenue"])');
    expect(c).toContain("Money fields are US DOLLARS");
  });

  it("customer_search sends totalSpentDollars beside the cents field and names the units", () => {
    const c = readCode("server/routes/nour-os-query.ts");
    expect(c).toContain("ROUND(totalSpent / 100, 2) AS totalSpentDollars");
    expect(c).toContain('moneyUnits: { totalSpent: "cents", totalSpentDollars: "USD" }');
  });
});

describe("money entering a cents column is converted", () => {
  it("invoice_paid (dollars on the bus) is added to customers.totalSpent as cents", () => {
    const c = readCode("server/services/eventBus.ts");
    expect(c).toContain("SET totalSpent = totalSpent + ${Math.round(Number(event.data.totalAmount || 0) * 100)}");
    expect(c).not.toMatch(/SET totalSpent = totalSpent \+ \$\{event\.data\.totalAmount \|\| 0\}/);
  });

  it("the dormant high-value cut compares cents to cents ($2,000), not to the dollar revenue target", () => {
    const c = readCode("server/routers/advanced/invoices.ts");
    expect(c).toContain("const HIGH_VALUE_CUSTOMER_CENTS = 200_000;");
    expect(c).not.toMatch(/totalSpent > \$\{MONTHLY_TARGET\}/);
  });
});

describe("masterIntelligence cash-flow factor reads the nested projection", () => {
  it("next7days / next30days are objects — read .projectedCash, not num() on the object", () => {
    const c = readCode("server/services/masterIntelligence.ts");
    expect(c).not.toContain('num(cashFlow, "next7days", "projectedCash")');
    expect(c).toContain('const next7 = projected("next7days");');
  });
});
