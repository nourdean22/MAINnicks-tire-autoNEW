import { describe, it, expect } from "vitest";
import { detectStitchPromptIntent } from "./detector";
import { validateEnhancedPrompt } from "./quality-gate";
import { resolveDesignContext, NICKSTIRE_BRAND_CONTEXT, GENERIC_FALLBACK_CONTEXT } from "./design-context";
import { EnhancedPromptOutput } from "./schema";

describe("Detector Tests", () => {
  it("triggers true positives correctly", () => {
    expect(detectStitchPromptIntent("enhance prompt for my landing page")).toBe(true);
    expect(detectStitchPromptIntent("design a mobile booking screen")).toBe(true);
    expect(detectStitchPromptIntent("turn this into a stitch prompt please")).toBe(true);
    expect(detectStitchPromptIntent("enhance this dashboard UI prompt")).toBe(true);
  });

  it("ignores unrelated messages", () => {
    expect(detectStitchPromptIntent("write me an Instagram caption")).toBe(false);
    expect(detectStitchPromptIntent("humanize this SMS message")).toBe(false);
    expect(detectStitchPromptIntent("fix this TypeScript compiler type error")).toBe(false);
  });
});

describe("Quality Gate Tests", () => {
  const validOutput: EnhancedPromptOutput = {
    oneLinePurpose: "A clean, trustworthy login page with centered components.",
    designSystem: {
      platform: "Web, Mobile-first",
      theme: "Light, minimal",
      background: "Clean White (#ffffff)",
      surface: "Light Gray (#f9fafb)",
      primaryAccent: "Deep Blue (#2563eb) for submit CTA",
      textPrimary: "Slate Gray (#111827)",
      textSecondary: "Slate Light (#6b7280)",
      typography: "Geometric sans-serif (Inter)",
      buttons: "Subtly rounded corners (8px)"
    },
    pageStructure: [
      { section: "Header", description: "Minimal logo placement" },
      { section: "Form Panel", description: "Email and password inputs" }
    ],
    constraints: ["Keep components aligned with Inter typography."],
    finalPromptMarkdown: "A clean, trustworthy login page...\n\n**DESIGN SYSTEM (REQUIRED):**\n- Platform: Web..."
  };

  it("passes a complete and compliant prompt", () => {
    const res = validateEnhancedPrompt(validOutput);
    expect(res.passed).toBe(true);
    expect(res.score).toBeGreaterThanOrEqual(85);
  });

  it("fails if required sections are missing or hex values are absent", () => {
    const invalidOutput = {
      ...validOutput,
      designSystem: {
        ...validOutput.designSystem,
        background: "white" // missing hex
      }
    };
    const res = validateEnhancedPrompt(invalidOutput);
    expect(res.passed).toBe(false);
    expect(res.score).toBeLessThan(85);
  });
});

describe("Design Context Resolver Tests", () => {
  it("resolves Nickstire brand fallback correctly when context specifies nickstire", () => {
    const ctx = resolveDesignContext(null, "nickstire");
    expect(ctx.source).toBe("nickstire_brand");
    expect(ctx.colorTokens).toEqual(NICKSTIRE_BRAND_CONTEXT.colorTokens);
  });

  it("resolves generic fallback otherwise", () => {
    const ctx = resolveDesignContext(null, "other-app");
    expect(ctx.source).toBe("fallback");
    expect(ctx.colorTokens).toEqual(GENERIC_FALLBACK_CONTEXT.colorTokens);
  });
});
