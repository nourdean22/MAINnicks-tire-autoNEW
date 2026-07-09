import { describe, it, expect } from "vitest";
import { runComplianceScan } from "../src/compliance/scanner.js";
import { generateCampaignPlan } from "../src/generator/index.js";
import { NicksTirePreset } from "../src/presets/nicks-tire.js";
import { CampaignOutputSchema } from "../src/schemas/output.js";
import { extractJsonObject } from "../src/generator/prompts.js";

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
  it("should generate a valid plan matching Zod schema using Nick's Tire preset (deterministic)", async () => {
    const plan = await generateCampaignPlan(NicksTirePreset);
    
    // Parse using Zod schema to ensure strict type compliance
    const parsed = CampaignOutputSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    expect(plan.campaignArchitecture.recommendedObjective).toBe("Leads");
    expect(plan.creativeTestingLab.creativeAngles.length).toBe(12);
    expect(plan.exportMetadata?.presetUsed).toBe("deterministic-no-llm-provider");
  });
});

describe("LLM Fallback & Fenced JSON Extraction", () => {
  it("fenced JSON extraction works", () => {
    const markdownStr = `Here is your JSON:\n\`\`\`json\n{"foo": "bar"}\n\`\`\`\nHope this helps!`;
    const parsed = extractJsonObject(markdownStr) as any;
    expect(parsed.foo).toBe("bar");
  });

  it("mocked LLM provider success returns presetUsed: llm-creative", async () => {
    // Generate valid base plan
    const basePlan = await generateCampaignPlan(NicksTirePreset);
    
    // Create a valid mock LLM response that matches the CREATIVE_SECTIONS_SCHEMA exactly
    const mockProvider = async () => {
      const validCreativeSections = {
        customerPsychologyMap: basePlan.customerPsychologyMap,
        adCopyFactory: basePlan.adCopyFactory,
        creativeTestingLab: basePlan.creativeTestingLab,
        creativePrompts: basePlan.creativePrompts,
        landingPageSystem: basePlan.landingPageSystem
      };
      // Let's modify one thing to ensure it used the LLM output
      validCreativeSections.creativeTestingLab.creativeThesis = "LLM Generated Thesis";
      return JSON.stringify(validCreativeSections);
    };

    const plan = await generateCampaignPlan(NicksTirePreset, mockProvider);
    expect(plan.exportMetadata?.presetUsed).toBe("llm-creative");
    expect(plan.creativeTestingLab.creativeThesis).toBe("LLM Generated Thesis");
    expect(CampaignOutputSchema.safeParse(plan).success).toBe(true);
  });

  it("mocked LLM provider failure returns deterministic fallback", async () => {
    const mockProvider = async () => {
      throw new Error("API Timeout");
    };

    const plan = await generateCampaignPlan(NicksTirePreset, mockProvider);
    expect(plan.exportMetadata?.presetUsed).toBe("deterministic-fallback");
    expect(CampaignOutputSchema.safeParse(plan).success).toBe(true);
  });

  it("malformed JSON falls back", async () => {
    const mockProvider = async () => {
      return "```json\n{ missing quotes }\n```";
    };

    const plan = await generateCampaignPlan(NicksTirePreset, mockProvider);
    expect(plan.exportMetadata?.presetUsed).toBe("deterministic-fallback");
    expect(CampaignOutputSchema.safeParse(plan).success).toBe(true);
  });

  it("schema-invalid LLM creative payload falls back", async () => {
    // If LLM returns valid JSON but misses required properties/lengths, CampaignOutputSchema will fail
    // and trigger the fallback.
    const mockProvider = async () => {
      return JSON.stringify({
        customerPsychologyMap: {}, // Invalid structure, missing properties
        adCopyFactory: [], // Missing 5 items
      });
    };

    const plan = await generateCampaignPlan(NicksTirePreset, mockProvider);
    expect(plan.exportMetadata?.presetUsed).toBe("deterministic-fallback");
    expect(CampaignOutputSchema.safeParse(plan).success).toBe(true);
  });

  it("compliance scanner catches unsafe language outside ad copy bundles", async () => {
    const basePlan = await generateCampaignPlan(NicksTirePreset);
    
    const mockProvider = async () => {
      const validCreativeSections = {
        ...basePlan
      };
      
      // Inject unsafe word "guaranteed" deep into creativeAngles
      // Our expanded extraction should catch this.
      validCreativeSections.creativeTestingLab.creativeAngles[0].hooks[0] = "Our service is guaranteed to be the best!";
      return JSON.stringify(validCreativeSections);
    };

    const plan = await generateCampaignPlan(NicksTirePreset, mockProvider);
    
    // Because the structure is valid, it shouldn't fallback
    expect(plan.exportMetadata?.presetUsed).toBe("llm-creative");
    
    // But the compliance scanner MUST catch "guaranteed"
    expect(plan.complianceRiskScan.riskLevel).toBe("high");
    expect(plan.complianceRiskScan.riskFlags.some(f => f.includes('banned superlative'))).toBe(true);
  });
});
