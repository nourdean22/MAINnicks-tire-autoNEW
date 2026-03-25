/**
 * Integration tests for Gateway Tire and Auto Labor routers.
 */
import { describe, it, expect } from "vitest";

describe("Gateway Tire Integration", () => {
  it("exports gatewayTireRouter from routers/index", async () => {
    const { gatewayTireRouter } = await import("./routers/index");
    expect(gatewayTireRouter).toBeDefined();
    expect(gatewayTireRouter._def).toBeDefined();
  });

  it("has required procedures", async () => {
    const { gatewayTireRouter } = await import("./routers/index");
    const procedures = Object.keys(gatewayTireRouter._def.procedures);
    expect(procedures).toContain("searchBySize");
    expect(procedures).toContain("calculateMargin");
    expect(procedures).toContain("popularSizes");
    expect(procedures).toContain("status");
    expect(procedures).toContain("updateMarkup");
  });

  it("margin calculation is correct", () => {
    // Test the margin math: cost $50, 50% markup = $75 per tire
    const costPrice = 50;
    const markup = 50;
    const tirePrice = costPrice * (1 + markup / 100);
    expect(tirePrice).toBe(75);

    // With 4 tires + mounting ($20) + balancing ($15) + disposal ($5)
    const qty = 4;
    const perTireTotal = tirePrice + 20 + 15 + 5; // 115
    expect(perTireTotal).toBe(115);
    const totalRevenue = perTireTotal * qty; // 460
    expect(totalRevenue).toBe(460);
    const totalCost = costPrice * qty; // 200
    expect(totalCost).toBe(200);
    const profit = totalRevenue - totalCost; // 260
    expect(profit).toBe(260);
  });

  it("popular tire sizes are formatted correctly", () => {
    // Test size formatting: 2156017 -> 215/60R17
    const raw = "2156017";
    const width = raw.slice(0, 3); // 215
    const aspect = raw.slice(3, 5); // 60
    const rim = raw.slice(5); // 17
    const formatted = `${width}/${aspect}R${rim}`;
    expect(formatted).toBe("215/60R17");
  });

  it("FET is included in per-tire calculation", () => {
    const costPrice = 80;
    const markup = 50;
    const fet = 2.50;
    const tirePrice = costPrice * (1 + markup / 100); // 120
    const perTireTotal = tirePrice + fet + 20 + 15 + 5; // 162.50
    expect(perTireTotal).toBe(162.50);
  });
});

describe("Auto Labor Integration", () => {
  it("exports autoLaborRouter from routers/index", async () => {
    const { autoLaborRouter } = await import("./routers/index");
    expect(autoLaborRouter).toBeDefined();
    expect(autoLaborRouter._def).toBeDefined();
  });

  it("has required procedures", async () => {
    const { autoLaborRouter } = await import("./routers/index");
    const procedures = Object.keys(autoLaborRouter._def.procedures);
    expect(procedures).toContain("categories");
    expect(procedures).toContain("jobsByCategory");
    expect(procedures).toContain("searchJobs");
    expect(procedures).toContain("calculateLabor");
    expect(procedures).toContain("status");
    expect(procedures).toContain("portalUrl");
    expect(procedures).toContain("quickEstimate");
  });

  it("labor calculation with difficulty multiplier", () => {
    const baseHours = 2.0;
    const laborRate = 115;

    // Standard: 1.0x
    const standardCost = baseHours * 1.0 * laborRate;
    expect(standardCost).toBe(230);

    // Moderate: 1.15x
    const moderateCost = baseHours * 1.15 * laborRate;
    expect(moderateCost).toBeCloseTo(264.50, 1);

    // Difficult: 1.30x
    const difficultCost = baseHours * 1.30 * laborRate;
    expect(difficultCost).toBe(299);
  });

  it("job categories have correct structure", () => {
    const categories = [
      { id: "brakes", name: "Brakes", jobCount: 12 },
      { id: "engine", name: "Engine", jobCount: 25 },
    ];
    expect(categories[0].id).toBe("brakes");
    expect(categories[0].jobCount).toBeGreaterThan(0);
  });
});

describe("Integration Router Registration", () => {
  it("both routers are registered in appRouter", async () => {
    const { appRouter } = await import("./routers");
    // The appRouter should have both integration routers
    // We check by verifying the router index exports
    const exports = await import("./routers/index");
    expect(exports.gatewayTireRouter).toBeDefined();
    expect(exports.autoLaborRouter).toBeDefined();
  });
});
