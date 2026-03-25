/**
 * Tests for the AI Labor Estimator module.
 */
import { describe, it, expect, vi } from "vitest";

// Mock the LLM module
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            repairTitle: "Front Brake Pad & Rotor Replacement",
            vehicleDisplay: "2018 Honda Civic",
            summary: "Replacement of front brake pads and rotors for safe stopping.",
            lineItems: [
              {
                description: "Front brake pads",
                laborHours: 0.8,
                laborCost: 92,
                partsLow: 35,
                partsHigh: 80,
                notes: "Aftermarket vs OEM pricing",
              },
              {
                description: "Front brake rotors",
                laborHours: 0.5,
                laborCost: 57.5,
                partsLow: 60,
                partsHigh: 150,
                notes: "Includes resurfacing or replacement",
              },
            ],
            totalLaborHours: 1.3,
            totalLaborCost: 149.5,
            totalPartsLow: 95,
            totalPartsHigh: 230,
            shopSupplies: 10,
            grandTotalLow: 254.5,
            grandTotalHigh: 389.5,
            timeEstimate: "1-2 hours",
            importantNotes: [
              "Estimate assumes front axle only.",
              "Brake fluid flush recommended every 2-3 years.",
            ],
            disclaimer:
              "This is an estimate. Final pricing may vary based on in-person inspection. Tax is additional.",
          }),
        },
      },
    ],
  }),
}));

import { generateLaborEstimate } from "./laborEstimate";

describe("generateLaborEstimate", () => {
  it("returns a structured estimate with all required fields", async () => {
    const result = await generateLaborEstimate({
      year: "2018",
      make: "Honda",
      model: "Civic",
      repairDescription: "Brake pads and rotors replacement",
    });

    expect(result).toBeDefined();
    expect(result.repairTitle).toBe("Front Brake Pad & Rotor Replacement");
    expect(result.vehicleDisplay).toBe("2018 Honda Civic");
    expect(result.summary).toBeTruthy();
    expect(result.lineItems).toHaveLength(2);
    expect(result.totalLaborHours).toBeGreaterThan(0);
    expect(result.totalLaborCost).toBeGreaterThan(0);
    expect(result.grandTotalLow).toBeGreaterThan(0);
    expect(result.grandTotalHigh).toBeGreaterThan(result.grandTotalLow);
    expect(result.timeEstimate).toBeTruthy();
    expect(result.importantNotes).toHaveLength(2);
    expect(result.disclaimer).toBeTruthy();
  });

  it("includes line items with labor hours and parts pricing", async () => {
    const result = await generateLaborEstimate({
      year: "2018",
      make: "Honda",
      model: "Civic",
      repairDescription: "Brake pads and rotors replacement",
    });

    const item = result.lineItems[0];
    expect(item.description).toBeTruthy();
    expect(item.laborHours).toBeGreaterThan(0);
    expect(item.laborCost).toBeGreaterThan(0);
    expect(item.partsLow).toBeGreaterThanOrEqual(0);
    expect(item.partsHigh).toBeGreaterThanOrEqual(item.partsLow);
    expect(item.notes).toBeTruthy();
  });

  it("accepts optional mileage parameter", async () => {
    const result = await generateLaborEstimate({
      year: "2015",
      make: "Toyota",
      model: "Camry",
      mileage: "95000",
      repairDescription: "Oil change",
    });

    expect(result).toBeDefined();
    expect(result.repairTitle).toBeTruthy();
  });

  it("returns fallback when LLM fails", async () => {
    const { invokeLLM } = await import("./_core/llm");
    (invokeLLM as any).mockRejectedValueOnce(new Error("LLM unavailable"));

    const result = await generateLaborEstimate({
      year: "2020",
      make: "Ford",
      model: "F-150",
      repairDescription: "Alternator replacement",
    });

    expect(result).toBeDefined();
    expect(result.repairTitle).toBe("Repair Estimate");
    expect(result.lineItems).toHaveLength(0);
    expect(result.grandTotalLow).toBe(0);
    expect(result.importantNotes.length).toBeGreaterThan(0);
  });
});
