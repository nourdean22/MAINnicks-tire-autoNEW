import { describe, it, expect } from "vitest";
import { getMarketingPersonas } from "@/lib/ai/agents/marketing/loader";

describe("marketing agents loader", () => {
  it("successfully loads and maps all 36 marketing personas", () => {
    const personas = getMarketingPersonas();
    const keys = Object.keys(personas);

    expect(keys.length).toBe(36);
    
    // Check specific agent properties to confirm parse accuracy
    const aeoFoundations = personas["marketing-aeo-foundations"];
    expect(aeoFoundations).toBeDefined();
    expect(aeoFoundations.role).toBe("AEO Foundations Architect");
    expect(aeoFoundations.goal).toContain("Expert in AI Engine Optimization infrastructure");
    expect(aeoFoundations.backstory).toContain("You are an AEO Foundations Architect");
    expect(aeoFoundations.outputHint).toBeDefined();

    const seoSpecialist = personas["marketing-seo-specialist"];
    expect(seoSpecialist).toBeDefined();
    expect(seoSpecialist.role).toBe("SEO Specialist");
    expect(seoSpecialist.goal).toContain("technical SEO");
  });
});
