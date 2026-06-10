import { describe, it, expect } from "vitest";

describe("Walk-In Calculator & Win-Back tire_customer Segment", () => {
  it("Used Tire preset has 0 labor hours (no double labor)", async () => {
    const { PRESETS } = await import("../../client/src/pages/admin/WalkInCalculatorSection");
    const usedTire = PRESETS.find(p => p.description.includes("Used Tire"));
    expect(usedTire).toBeDefined();
    expect(usedTire?.laborHours).toBe(0);
  });

  it("tire_customer targetSegment enum is accepted by winbackRouter input schema", async () => {
    const { winbackRouter } = await import("../routers/winback");
    const inputSchema = (winbackRouter as any).create?._def?.inputs?.[0];
    expect(inputSchema).toBeDefined();
    const result = inputSchema.safeParse({
      name: "Test Campaign",
      targetSegment: "tire_customer",
      customMessages: []
    });
    expect(result.success).toBe(true);
  });
});
