import { describe, it, expect, vi } from "vitest";
import { invoices, tireOrders, serviceHistory } from "../../drizzle/schema";

describe("Walk-In Calculator & Win-Back tire_customer Segment", () => {
  it("Used Tire preset has 0 labor hours (no double labor)", async () => {
    const { PRESETS } = await import("../../client/src/pages/admin/WalkInCalculatorSection");
    const usedTire = PRESETS.find(p => p.description.includes("Used Tire"));
    expect(usedTire).toBeDefined();
    expect(usedTire?.laborHours).toBe(0);
  });

  it("tire_customer targetSegment enum is accepted by winbackRouter input schema", async () => {
    const { winbackRouter } = await import("../routers/winback");
    const inputSchema = (winbackRouter as any).create?._def?.inputs?.[0];
    expect(inputSchema).toBeDefined();
    const result = inputSchema.safeParse({
      name: "Test Campaign",
      targetSegment: "tire_customer",
      customMessages: []
    });
    expect(result.success).toBe(true);
  });

  it("personalizeWinbackBody uses fallback generic text for customer without verified tire purchases", async () => {
    const { personalizeWinbackBody } = await import("../routers/winback");
    const originalBody = "It's time for your free tire rotation at Nick's!";
    const customer = {
      firstName: "John",
      vehicleYear: 2018,
      vehicleMake: "Honda",
      vehicleModel: "Civic",
    };
    const result = personalizeWinbackBody(originalBody, customer, false);
    expect(result).toContain("Still need tires or service?");
    expect(result).not.toContain("free tire rotation");
    expect(result).toContain("Reply STOP to opt out");
  });

  it("personalizeWinbackBody uses tire-specific text for customer with verified tire purchases", async () => {
    const { personalizeWinbackBody } = await import("../routers/winback");
    const originalBody = "It's time for your free tire rotation at Nick's!";
    const customer = {
      firstName: "John",
      vehicleYear: 2018,
      vehicleMake: "Honda",
      vehicleModel: "Civic",
    };
    const result = personalizeWinbackBody(originalBody, customer, true);
    expect(result).toContain("free tire rotation");
    expect(result).not.toContain("Still need tires or service?");
    expect(result).toContain("Reply STOP to opt out");
  });

  it("withOptOut appends opt-out footers to SMS if not present", async () => {
    const { withOptOut } = await import("../sms");
    const testMsg = "Hello from Nick's!";
    const result = withOptOut(testMsg);
    expect(result).toContain("Reply STOP to opt out.");
    
    // Test that it does not double append if already present
    const doubleResult = withOptOut(result);
    expect(doubleResult).toBe(result);
  });

  it("getVerifiedTirePurchaseCustomerIds checks invoices, tire_orders, and service_history", async () => {
    const { getVerifiedTirePurchaseCustomerIds } = await import("../routers/winback");

    // Setup mock DB builder
    const mockSelect = vi.fn().mockImplementation(() => {
      return {
        from: vi.fn().mockImplementation((table) => {
          return {
            where: vi.fn().mockImplementation(() => {
              if (table === invoices) {
                return [
                  { customerId: 1 },
                  { customerId: null },
                ];
              } else if (table === tireOrders) {
                return [
                  { customerId: 2 },
                  { customerId: 3 },
                ];
              } else if (table === serviceHistory) {
                return [
                  { userId: 4 },
                  { userId: null },
                ];
              }
              return [];
            })
          };
        })
      };
    });

    const mockDb = {
      select: mockSelect,
    };

    const verifiedSet = await getVerifiedTirePurchaseCustomerIds(mockDb, [1, 2, 3, 4, 5]);
    expect(verifiedSet).toBeInstanceOf(Set);
    expect(verifiedSet.has(1)).toBe(true); // From invoices
    expect(verifiedSet.has(2)).toBe(true); // From tireOrders
    expect(verifiedSet.has(3)).toBe(true); // From tireOrders
    expect(verifiedSet.has(4)).toBe(true); // From serviceHistory
    expect(verifiedSet.has(5)).toBe(false); // No purchase
    expect(verifiedSet.size).toBe(4);
  });
});
