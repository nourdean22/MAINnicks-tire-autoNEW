import { describe, it, expect } from "vitest";
import { runComplianceScan } from "../src/compliance/scanner.js";
import { generateCampaignPlan } from "../src/generator/index.js";
import { NicksTirePreset } from "../src/presets/nicks-tire.js";
import { CampaignOutputSchema } from "../src/schemas/output.js";

describe("Meta Ads Architect Compliance Engine", () => {
  it("should flag unsafe automotive claims", () => {
    const scan = runComplianceScan(["We guarantee you will pass your e-check and prevent accidents."]);
    expect(scan.riskLevel).toBe("high");
    expect(scan.riskFlags.length).toBeGreaterThan(0);
    expect(scan.safePhrasingSwaps.some(s => s.unsafe === "guaranteed")).toBe(true);
  });

  it("should flag bad free usage", () => {
    const scan = runComplianceScan(["Get free tires and a free engine."]);
    expect(scan.riskFlags.some(f => f.includes('"free" used outside'))).toBe(true);
  });

  it("should not flag valid free check usage", () => {
    const scan = runComplianceScan(["Come in for a free tire check."]);
    expect(scan.riskFlags.some(f => f.includes('"free" used outside'))).toBe(false);
  });

  it("should flag HTML entity leaks", () => {
    const scan = runComplianceScan(["Tires &amp; Brakes"]);
    expect(scan.riskFlags.some(f => f.includes('HTML entity leaked'))).toBe(true);
  });

  it("should flag banned superlatives", () => {
    const scan = runComplianceScan(["We have the cheapest and best premium quality tires."]);
    expect(scan.riskFlags.some(f => f.includes('banned superlative'))).toBe(true);
  });

  it("should pass safe copy with low risk", () => {
    const scan = runComplianceScan(["Get your free quick check today at Nick's Tire."]);
    expect(scan.riskLevel).toBe("low");
  });
});

describe("Generator & Schema Output", () => {
  it("should generate a valid plan matching Zod schema using Nick's Tire preset", async () => {
    const plan = await generateCampaignPlan(NicksTirePreset);
    
    // Parse using Zod schema to ensure strict type compliance
    const parsed = CampaignOutputSchema.safeParse(plan);
    
    if (!parsed.success) {
      console.error(parsed.error);
    }
    
    expect(parsed.success).toBe(true);
    expect(plan.campaignArchitecture.recommendedObjective).toBe("Leads");
    expect(plan.creativeTestingLab.creativeAngles.length).toBe(12);
  });
});
