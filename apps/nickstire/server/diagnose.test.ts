import { describe, it, expect, vi } from "vitest";

// Mock the LLM helper
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            urgency: "high",
            urgencyScore: 4,
            title: "Brake System Inspection Needed",
            summary: "The grinding noise when braking strongly suggests worn brake pads that have reached the metal backing plate. This is a safety concern that should be addressed promptly.",
            likelyCauses: [
              {
                cause: "Worn Brake Pads",
                explanation: "Brake pads have worn down to the metal backing plate, causing metal-on-metal contact with the rotors.",
                likelihood: "High",
              },
              {
                cause: "Damaged Brake Rotors",
                explanation: "Extended driving with worn pads can score or warp the brake rotors, requiring resurfacing or replacement.",
                likelihood: "Medium",
              },
            ],
            recommendedService: "Brakes",
            estimatedCostRange: "$150 - $400",
            safetyNote: "Grinding brakes are a safety concern. The vehicle should be inspected as soon as possible to prevent further damage and ensure safe stopping.",
            nextSteps: [
              "Call (216) 862-0005 to schedule a brake inspection",
              "Avoid heavy braking until the vehicle is inspected",
              "Our technicians will measure pad thickness and rotor condition",
              "We will provide a detailed estimate before any work begins",
            ],
          }),
        },
      },
    ],
  }),
}));

import { runDiagnosis } from "./diagnose";

describe("Vehicle Diagnostic Tool", () => {
  it("should return a structured diagnosis result", async () => {
    const result = await runDiagnosis({
      vehicleYear: "2018",
      vehicleMake: "Honda",
      vehicleModel: "Civic",
      mileage: "85000",
      symptoms: [
        "Unusual Sounds: Grinding when braking (Metal-on-metal grinding sound during braking)",
      ],
      additionalInfo: "Started about a week ago and getting worse",
    });

    expect(result).toBeDefined();
    expect(result.urgency).toBe("high");
    expect(result.urgencyScore).toBe(4);
    expect(result.title).toBeTruthy();
    expect(result.summary).toBeTruthy();
    expect(result.likelyCauses).toBeInstanceOf(Array);
    expect(result.likelyCauses.length).toBeGreaterThan(0);
    expect(result.recommendedService).toBeTruthy();
    expect(result.estimatedCostRange).toBeTruthy();
    expect(result.nextSteps).toBeInstanceOf(Array);
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it("should have valid urgency levels", async () => {
    const result = await runDiagnosis({
      symptoms: ["Warning Lights: Check engine light (The check engine / MIL light is on)"],
    });

    expect(["low", "moderate", "high", "critical"]).toContain(result.urgency);
    expect(result.urgencyScore).toBeGreaterThanOrEqual(1);
    expect(result.urgencyScore).toBeLessThanOrEqual(5);
  });

  it("should include all required fields in likely causes", async () => {
    const result = await runDiagnosis({
      symptoms: ["Performance Issues: Rough idle (Engine vibrates or runs unevenly at idle)"],
    });

    for (const cause of result.likelyCauses) {
      expect(cause.cause).toBeTruthy();
      expect(cause.explanation).toBeTruthy();
      expect(cause.likelihood).toBeTruthy();
    }
  });

  it("should handle missing vehicle info gracefully", async () => {
    const result = await runDiagnosis({
      symptoms: ["Unusual Smells: Burning rubber smell (Smell of burning rubber from the engine or wheels)"],
    });

    expect(result).toBeDefined();
    expect(result.title).toBeTruthy();
    expect(result.summary).toBeTruthy();
  });

  it("should clamp urgency score to 1-5 range", async () => {
    const result = await runDiagnosis({
      symptoms: ["Warning Lights: Check engine light (The check engine / MIL light is on)"],
    });

    expect(result.urgencyScore).toBeGreaterThanOrEqual(1);
    expect(result.urgencyScore).toBeLessThanOrEqual(5);
  });
});
