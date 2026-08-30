/**
 * Regression · TiDB int ids must not reach BrainMemory.key (2026-08-30).
 *
 * Found live in prod logs: the daily customer-preferences recompute threw
 * "Invalid `prisma.brainMemory.upsert()` invocation — Argument `key`:
 * Invalid value provided. Expected String, provided Int" for EVERY customer
 * (64+ blocks in one 5k-line window; 28 distinct numeric ids). Root cause:
 * nickstire's `customers.id` is a TiDB autoincrement INT, the bridge
 * returns it as a JSON number, and `inferCustomerPreferences` passed it
 * through to `prefs.customerId` — the BrainMemory upsert key — uncoerced.
 * Preferences have never persisted since the 2026-07-10 phone-keyed
 * rewrite of the bridge handler.
 *
 * These pin the COERCION at the inference boundary: a numeric id in,
 * a string key out. On the pre-fix code the first assertion fails
 * (customerId is a number) and a downstream upsert would throw.
 */
import { describe, it, expect } from "vitest";
import { inferCustomerPreferences, type CustomerDetailInput } from "@/lib/brain/customer-preferences";

function detailWithNumericId(id: number): CustomerDetailInput {
  return {
    // The deliberate hazard: a JSON number where the contract says
    // string. This is exactly what queryNick("customer_detail") returns
    // for every TiDB customer today.
    customer: {
      id,
      firstName: "Test",
      lastName: "Customer",
      phone: "+12165551234",
      segment: "retail",
      totalVisits: 6,
      totalSpent: 250_00,
      lastVisitDate: "2026-08-01",
      createdAt: "2024-01-15",
    },
    timeline: { invoices: [], estimates: [], algEstimates: [], callbacks: [] },
  };
}

describe("inferCustomerPreferences · TiDB int id coercion", () => {
  it("BREAKS: a numeric bridge id yields a STRING customerId (BrainMemory key)", () => {
    const prefs = inferCustomerPreferences(detailWithNumericId(210103));
    expect(typeof prefs.customerId).toBe("string");
    expect(prefs.customerId).toBe("210103");
  });

  it("string ids pass through unchanged", () => {
    const prefs = inferCustomerPreferences(detailWithNumericId(Number("210103")));
    const fromString = inferCustomerPreferences({
      ...detailWithNumericId(0),
      customer: { ...detailWithNumericId(0).customer, id: "210103" },
    });
    expect(prefs.customerId).toBe(fromString.customerId);
    expect(fromString.customerId).toBe("210103");
  });

  it("metadata carries the coerced id, so persisted rows key consistently", () => {
    const prefs = inferCustomerPreferences(detailWithNumericId(53));
    expect(prefs.customerId).toBe("53");
    // The summary is the persisted `content` — it must not embed the
    // uncoerced type anywhere either (it doesn't contain the id at all;
    // this pins that property so nobody adds `customer #${id}` sloppily).
    expect(prefs.summary).not.toMatch(/53/);
  });
});