/**
 * Q-46 (wording) · OAC 109:4-3-13 on the public online estimate.
 *
 * The labor estimator prices a repair from the customer's own description.
 * Nobody has inspected the car, so model-written text that calls the repair
 * "necessary", the car "dangerous" or the fix "urgent" is a representation
 * with no inspection finding behind it. These tests drive the REAL
 * generateLaborEstimate with a model reply full of those verdicts and assert
 * the customer never sees them, while hedged and neutral sentences survive.
 * The estimate also carries the shop's estimate-choice notice and a
 * server-owned disclaimer instead of whatever the model wrote.
 */
import { describe, it, expect, vi } from "vitest";

const VERDICT_REPLY = {
  repairTitle: "Urgent Front Brake Replacement",
  vehicleDisplay: "2016 Honda Accord",
  summary:
    "Your brakes are dangerous to drive on. Replacing the pads and rotors is necessary right away. The job covers both front wheels.",
  lineItems: [
    {
      description: "Front brake pads",
      laborHours: 0.8,
      laborCost: 92,
      partsLow: 35,
      partsHigh: 80,
      notes: "Worn pads are unsafe. Aftermarket vs OEM pricing.",
    },
    {
      description: "Front brake rotors",
      laborHours: 0.5,
      laborCost: 57.5,
      partsLow: 60,
      partsHigh: 150,
      notes: "Resurfacing if necessary, otherwise replacement.",
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
    "This repair should be done immediately.",
    "Estimate assumes front axle only.",
  ],
  disclaimer: "Prices are final.",
};

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(async () => ({
    choices: [{ message: { content: JSON.stringify(VERDICT_REPLY) } }],
  })),
}));

import { generateLaborEstimate } from "./laborEstimate";

const VERDICT = /\b(dangerous|unsafe|necessary|urgent|immediately)\b/i;

function customerText(r: Awaited<ReturnType<typeof generateLaborEstimate>>): string[] {
  return [
    r.repairTitle,
    r.summary,
    ...r.lineItems.map((li) => li.notes),
    ...r.importantNotes,
  ];
}

describe("online estimate wording (Q-46, OAC 109:4-3-13)", () => {
  it("drops unhedged necessity, danger and urgency verdicts from every customer-visible field", async () => {
    const r = await generateLaborEstimate({
      year: "2016", make: "Honda", model: "Accord", repairDescription: "brakes squeal",
    });
    const offending = customerText(r).filter((t) => VERDICT.test(t) && !/if necessary/i.test(t));
    expect(offending).toEqual([]);
  });

  it("keeps the neutral and hedged sentences (not a blanket wipe)", async () => {
    const r = await generateLaborEstimate({
      year: "2016", make: "Honda", model: "Accord", repairDescription: "brakes squeal",
    });
    expect(r.summary).toBe("The job covers both front wheels.");
    expect(r.lineItems[0].notes).toBe("Aftermarket vs OEM pricing.");
    expect(r.lineItems[1].notes).toBe("Resurfacing if necessary, otherwise replacement.");
    expect(r.importantNotes).toEqual(["Estimate assumes front axle only."]);
    expect(r.repairTitle).toBe("Front Brake Replacement");
    // Prices are the model's and are untouched.
    expect(r.grandTotalLow).toBe(254.5);
    expect(r.grandTotalHigh).toBe(389.5);
  });

  it("carries the estimate choice and a server-owned disclaimer, not the model's", async () => {
    const r = await generateLaborEstimate({
      year: "2016", make: "Honda", model: "Accord", repairDescription: "brakes squeal",
    });
    expect(r.estimateChoice).toMatch(/written estimate/i);
    expect(r.estimateChoice).toMatch(/oral estimate/i);
    expect(r.estimateChoice).toMatch(/no estimate/i);
    expect(r.disclaimer).not.toBe("Prices are final.");
    expect(r.disclaimer).toMatch(/has not been inspected/i);
    expect(r.disclaimer).toMatch(/tax is additional/i);
  });

  it("the fallback estimate carries the same notice and disclaimer", async () => {
    const { invokeLLM } = await import("./_core/llm");
    (invokeLLM as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(new Error("down"));
    const r = await generateLaborEstimate({
      year: "2020", make: "Ford", model: "F-150", repairDescription: "alternator",
    });
    expect(r.lineItems).toHaveLength(0);
    expect(r.estimateChoice).toMatch(/written estimate/i);
    expect(r.disclaimer).toMatch(/tax is additional/i);
  });
});
