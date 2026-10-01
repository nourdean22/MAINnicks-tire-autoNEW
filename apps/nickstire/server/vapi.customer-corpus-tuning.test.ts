import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT } from "./services/vapi";

describe("VAPI corpus-grounded conversation rules", () => {
  it("starts neutral instead of assuming a used-tire caller", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("# START NEUTRAL");
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("Most callers want USED TIRES");
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("Default TIRE-FIRST");
  });

  it("keeps turns short and interactive", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/ONE idea per turn/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/at most ONE question per turn/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/aim for 18 spoken words or fewer/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/deliver ONE beat, pause for the caller/);
  });

  it("does not invent a midday queue condition", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("line gets long mid-day");
  });

  it("does not use the unsupported dealer-chain superiority claim", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("Cheaper than the dealer, faster than the chains, more honest than both");
  });

  it("does not diagnose squeaking brakes as probably just pads", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).not.toContain("often still just the pads");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("brake problems usually get more expensive when they wait");
  });
});
