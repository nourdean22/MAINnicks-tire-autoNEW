import { describe, it, expect } from "vitest";
import { PRESETS } from "../pages/admin/WalkInCalculatorSection";
import { OIL_PRICE } from "@shared/pricing";

describe("Walk-In Calculator Presets", () => {
  it("defines PRESETS properly referencing OIL_PRICE", () => {
    expect(PRESETS).toBeDefined();
    expect(PRESETS.length).toBeGreaterThan(2);

    // Conventional Oil
    const conv = PRESETS.find(p => p.description.toLowerCase().includes("conventional"));
    expect(conv).toBeDefined();
    expect(conv?.laborHours).toBe(0);
    // Dynamic starting price description check
    expect(conv?.description).toContain(`starting at $${OIL_PRICE.conventional}`);
    // Calculated total price check: partsCostCents * partsMarkup = 24.50 * 2 = 49.00
    const convTotal = (conv!.partsCostCents * conv!.partsMarkup) / 100;
    expect(convTotal).toBe(OIL_PRICE.conventional);

    // Full Synthetic Oil
    const syn = PRESETS.find(p => p.description.toLowerCase().includes("synthetic"));
    expect(syn).toBeDefined();
    expect(syn?.laborHours).toBe(0);
    expect(syn?.description).toContain(`starting at $${OIL_PRICE.fullSynthetic}`);
    const synTotal = (syn!.partsCostCents * syn!.partsMarkup) / 100;
    expect(synTotal).toBe(OIL_PRICE.fullSynthetic);
  });
});
