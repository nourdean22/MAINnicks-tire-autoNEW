import { parseLeadIntake } from "@/lib/scoring/lead-parser";

describe("parseLeadIntake", () => {
  it("defaults to OTHER and MEDIUM when no keywords match", () => {
    const result = parseLeadIntake("Need some help eventually with the car.");

    expect(result.leadType).toBe("OTHER");
    expect(result.urgency).toBe("MEDIUM");
    expect(result.valueEstimate).toBe(300);
  });

  it("detects urgent brake leads", () => {
    const result = parseLeadIntake("Need brakes today, they are grinding hard.");

    expect(result.leadType).toBe("BRAKES");
    expect(result.urgency).toBe("HIGH");
    expect(result.valueEstimate).toBeGreaterThan(900);
  });
});
