import { describe, it, expect } from "vitest";
import { convertToAction } from "../../../lib/knowledge/action-converter";

describe("knowledge -> action converter", () => {
  it("turns an obvious actionable insight into a task with a next physical action", () => {
    const s = convertToAction({ sourceType: "chat", text: "I need to call the brake-pad vendor about the backorder." });
    expect(s.kind).toBe("task");
    expect(s.nextPhysicalAction).toBeTruthy();
    expect(s.nextPhysicalAction!.toLowerCase()).toContain("call");
    expect(s.nextPhysicalAction!.toLowerCase()).not.toContain("i need to");
  });

  it("turns a repeated principle into a rule", () => {
    const s = convertToAction({ sourceType: "journal", text: "From now on, always confirm the tire size before quoting." });
    expect(s.kind).toBe("rule");
  });

  it("turns a hypothesis into an experiment", () => {
    const s = convertToAction({ sourceType: "journal", text: "What if we test offering same-day alignment as a pilot?" });
    expect(s.kind).toBe("experiment");
  });

  it("logs a stated choice as a decision", () => {
    const s = convertToAction({ sourceType: "chat", text: "We decided to go with the Neon Postgres plan over self-hosting." });
    expect(s.kind).toBe("decision");
  });

  it("ignores vague / tentative text", () => {
    const s = convertToAction({ sourceType: "chat", text: "hmm maybe something about pricing idk" });
    expect(s.kind).toBe("ignore");
  });

  it("ignores a bare question", () => {
    expect(convertToAction({ sourceType: "chat", text: "What should I focus on this week?" }).kind).toBe("ignore");
  });

  it("ignores text too short to act on", () => {
    expect(convertToAction({ sourceType: "chat", text: "ok" }).kind).toBe("ignore");
  });

  it("falls back to a memory for substantive non-actionable facts", () => {
    const s = convertToAction({ sourceType: "chat", text: "The new supplier ships out of Columbus and restocks on Tuesdays." });
    expect(s.kind).toBe("memory");
  });

  it("carries domain + mission through when provided", () => {
    const s = convertToAction({
      sourceType: "chat",
      text: "Need to follow up with the fleet account about Q3 pricing.",
      domain: "business",
      missionId: "m-123",
    });
    expect(s.suggestedDomain).toBe("business");
    expect(s.suggestedMissionId).toBe("m-123");
  });

  it("flags a sensitive/destructive action as requiresApproval", () => {
    const s = convertToAction({ sourceType: "chat", text: "Text the customer that their car is ready and charge the card on file." });
    expect(s.kind).toBe("task");
    expect(s.requiresApproval).toBe(true);
    expect(s.riskLevel).toBe("high");
  });

  it("is suggestion-only and pure — identical input gives identical output, no mutation", () => {
    const input = { sourceType: "chat" as const, text: "I should schedule the oil-change reminder blast." };
    expect(convertToAction(input)).toEqual(convertToAction(input));
  });
});
