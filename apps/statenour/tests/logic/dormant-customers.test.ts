import { scanDormantCustomers } from "@/lib/scoring/dormant-customers";

describe("scanDormantCustomers", () => {
  it("assigns dormant risk and higher recovery score to valuable stale customers", () => {
    const [customer] = scanDormantCustomers(
      [
        {
          id: "customer-1",
          fullName: "Marcus Hill",
          lastVisitDate: "2025-01-01T00:00:00.000Z",
          totalSpend: 4200,
          visitCount: 7,
          lastService: "Tires"
        }
      ],
      new Date("2025-08-01T00:00:00.000Z")
    );

    expect(customer.effectiveRiskStatus).toBe("DORMANT");
    expect(customer.recoveryScore).toBeGreaterThan(70);
    expect(customer.outreachDraft).toContain("Marcus Hill");
  });

  it("respects manual risk overrides", () => {
    const [customer] = scanDormantCustomers([
      {
        id: "customer-1",
        fullName: "Dana Brooks",
        totalSpend: 200,
        visitCount: 1,
        manualRiskOverride: "LOST"
      }
    ]);

    expect(customer.effectiveRiskStatus).toBe("LOST");
  });
});
