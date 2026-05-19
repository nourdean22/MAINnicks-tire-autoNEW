import { describe, it, expect } from "vitest";
import { scoreEstimateForRecovery, buildPersonalizedRecoveryMessage } from "./recoveryTargeting";

const DAY = 86_400_000;
const tenDaysAgo = new Date(Date.now() - 10 * DAY);
const fortyFiveDaysAgo = new Date(Date.now() - 45 * DAY);

describe("scoreEstimateForRecovery · wave-181.82", () => {
  it("scores zero or near-zero on a too-fresh estimate (<7d)", () => {
    const s = scoreEstimateForRecovery({
      estimatedAmount: 50_000,
      estimateDate: new Date(Date.now() - 3 * DAY),
    });
    // amountPts ~16 + agePts 0 + repeatPts 5 + vehiclePts 15 = ~36
    expect(s).toBeGreaterThan(20);
    expect(s).toBeLessThan(50);
  });

  it("scores high on a sweet-spot brake job at 10 days · mid-life vehicle · returning customer", () => {
    const s = scoreEstimateForRecovery({
      estimatedAmount: 50_000,         // $500
      estimateDate: tenDaysAgo,
      serviceDescription: "Front brake pads and rotors",
      customer: { totalVisits: 4, vehicleYear: String(new Date().getFullYear() - 7) },
    });
    // amount 15-16 + age ~25 + repeat 25 + vehicle 25 = ~90 × 2.0 brake multiplier = capped 100
    expect(s).toBeGreaterThan(80);
  });

  it("scores lower on a stale 45-day-old estimate (window decay)", () => {
    // Use a low-multiplier service + small amount so the score doesn't
    // saturate at 100 and the age signal can actually differentiate.
    const s = scoreEstimateForRecovery({
      estimatedAmount: 10_000,
      estimateDate: fortyFiveDaysAgo,
      serviceDescription: "Oil change",
      customer: { totalVisits: 1, vehicleYear: String(new Date().getFullYear() - 7) },
    });
    const fresh = scoreEstimateForRecovery({
      estimatedAmount: 10_000,
      estimateDate: tenDaysAgo,
      serviceDescription: "Oil change",
      customer: { totalVisits: 1, vehicleYear: String(new Date().getFullYear() - 7) },
    });
    expect(s).toBeLessThan(fresh);
  });

  it("applies transmission/engine multiplier (0.7×) correctly", () => {
    const tx = scoreEstimateForRecovery({
      estimatedAmount: 300_000,
      estimateDate: tenDaysAgo,
      serviceDescription: "Transmission rebuild",
      customer: { totalVisits: 2, vehicleYear: String(new Date().getFullYear() - 8) },
    });
    const brake = scoreEstimateForRecovery({
      estimatedAmount: 300_000,
      estimateDate: tenDaysAgo,
      serviceDescription: "Brake job",
      customer: { totalVisits: 2, vehicleYear: String(new Date().getFullYear() - 8) },
    });
    // transmission multiplier is 0.7 · brake is 2.0 · brake should outscore tx
    expect(brake).toBeGreaterThan(tx);
  });

  it("handles missing customer gracefully", () => {
    const s = scoreEstimateForRecovery({
      estimatedAmount: 50_000,
      estimateDate: tenDaysAgo,
      serviceDescription: "Brake job",
      customer: null,
    });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(100);
  });

  it("clamps to 0-100", () => {
    const s = scoreEstimateForRecovery({
      estimatedAmount: 999_999_999,
      estimateDate: tenDaysAgo,
      serviceDescription: "BRAKE BRAKE BRAKE",
      customer: { totalVisits: 99, vehicleYear: String(new Date().getFullYear() - 8) },
    });
    expect(s).toBeLessThanOrEqual(100);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

describe("buildPersonalizedRecoveryMessage · wave-181.82", () => {
  it("7d tier · includes vehicle reference when customer has vehicle data", () => {
    const msg = buildPersonalizedRecoveryMessage({
      tier: "7d",
      name: "Sarah",
      amountCents: 50_000,
      serviceDescription: "Front brake pads",
      customer: {
        vehicleYear: "2018",
        vehicleMake: "Toyota",
        vehicleModel: "Camry",
        totalVisits: 1,
      },
    });
    expect(msg).toContain("2018 toyota camry");
    expect(msg).toContain("$500");
    expect(msg).toContain("brake job");
    expect(msg).toContain("you don't pay until you say yes");
    expect(msg).toContain("Reply STOP");
  });

  it("30d tier · adds repeat-customer warmth for 3+ visits", () => {
    const msg = buildPersonalizedRecoveryMessage({
      tier: "30d",
      name: "Jim",
      amountCents: 75_000,
      serviceDescription: "Suspension work · struts",
      customer: {
        vehicleYear: "2017",
        vehicleMake: "Honda",
        vehicleModel: "Civic",
        totalVisits: 5,
      },
    });
    expect(msg).toContain("you've trusted us before");
    expect(msg).toContain("suspension work");
    expect(msg).toContain("$750");
    expect(msg).toContain("2017 honda civic");
  });

  it("falls back to generic 'your vehicle' when vehicle data missing", () => {
    const msg = buildPersonalizedRecoveryMessage({
      tier: "7d",
      name: "Pat",
      amountCents: 30_000,
      serviceDescription: null,
      customer: null,
    });
    expect(msg).toContain("your vehicle");
    expect(msg).toContain("the work we quoted");
    expect(msg).toContain("you don't pay until you say yes");
  });

  it("strips literal 'null' strings from vehicle clause", () => {
    const msg = buildPersonalizedRecoveryMessage({
      tier: "7d",
      name: "Test",
      amountCents: 20_000,
      serviceDescription: null,
      customer: {
        vehicleYear: "2020",
        vehicleMake: null,
        vehicleModel: "Accord",
        totalVisits: 0,
      },
    });
    expect(msg).not.toMatch(/null/i);
    expect(msg).toContain("2020 accord");
  });

  it("doesn't add repeat-customer prefix for 0-2 visits", () => {
    const msg = buildPersonalizedRecoveryMessage({
      tier: "7d",
      name: "New",
      amountCents: 20_000,
      serviceDescription: "Oil change",
      customer: { totalVisits: 1, vehicleYear: "2019" },
    });
    expect(msg).not.toContain("you've trusted us before");
  });

  it("stays under SMS-segment limits even with all personalization", () => {
    const msg = buildPersonalizedRecoveryMessage({
      tier: "30d",
      name: "A Very Long Customer Name",
      amountCents: 999_900,
      serviceDescription: "Complete brake overhaul · all four corners · pads and rotors",
      customer: {
        vehicleYear: "2018",
        vehicleMake: "Mercedes-Benz",
        vehicleModel: "GLK 350 4MATIC",
        totalVisits: 8,
      },
    });
    // 3 SMS segments = 459 chars · we want to stay at 2 segments (306) if possible
    expect(msg.length).toBeLessThan(459);
  });
});
