/**
 * 2026-11-06 · Nour: "the receptionist doesnt need to do bookings or give me a callback text".
 * escalate now writes nothing (voiceAgent.noCallbackObligation.test.ts), so no served line may
 * offer or promise a callback: not the receptionist prompt, not the escalate tool text, not the
 * no-answer fallback line, not the follow-up caller. These reach callers only after Nour pushes
 * the config (Admin > Voice Receptionist > Push Latest Config).
 */
import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT, FOLLOW_UP_SYSTEM_PROMPT, VAPI_TOOLS, buildAssistantConfig } from "./services/vapi";

const OFFERS_A_CALLBACK = /callback list|call you back\b|have someone[^.]{0,40}call|someone will call|the shop will call|for the callback/i;

type Tool = { type?: string; function?: { name?: string; description?: string; parameters?: { properties?: Record<string, { description?: string }> } } };
const escalate = (VAPI_TOOLS as unknown as Tool[]).find((t) => t.function?.name === "escalate")!.function!;
const fallbackLine = (): string => {
  const tools = buildAssistantConfig("https://nickstire.org/api/webhooks/vapi").model.tools as Array<{ type?: string; destinations?: Array<{ transferPlan?: { fallbackPlan?: { message?: string } } }> }>;
  return tools.find((t) => t.type === "transferCall")?.destinations?.[0]?.transferPlan?.fallbackPlan?.message ?? "";
};

describe("no served line offers or promises a callback", () => {
  it("POSITIVE CONTROL: the matcher catches the old lines", () => {
    for (const old of [
      "You're on the callback list for when we open.",
      "Sorry, nobody could grab the phone up front. Want the shop to call you back?",
      "Want me to have someone from the shop call you back instead?",
      "you're on the shop's callback list, someone will call you back",
    ]) expect(old).toMatch(OFFERS_A_CALLBACK);
  });

  it("the receptionist prompt", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(OFFERS_A_CALLBACK);
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("Never tell a caller anyone will call them back");
  });

  it("the escalate tool says it records nothing for the shop to do", () => {
    expect(escalate.description).not.toMatch(OFFERS_A_CALLBACK);
    expect(escalate.description).toMatch(/schedules NO callback/);
    expect(Object.keys(escalate.parameters?.properties ?? {}).sort()).toEqual(["reason", "urgency"]);
  });

  it("the no-answer fallback line", () => {
    const line = fallbackLine();
    expect(line).not.toBe("");
    expect(line).not.toMatch(OFFERS_A_CALLBACK);
    expect(line).not.toMatch(/\?/);
  });

  it("the follow-up caller", () => {
    expect(FOLLOW_UP_SYSTEM_PROMPT).not.toMatch(OFFERS_A_CALLBACK);
  });
});
