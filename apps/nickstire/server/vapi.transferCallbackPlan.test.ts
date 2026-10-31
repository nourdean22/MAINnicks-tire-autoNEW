/**
 * Unanswered transfer -> back to the bot -> callback (Nour, 2026-10-31: "Yes, add it").
 *
 * Vapi's assistant-based warm transfer rolls a busy or unanswered destination back
 * to the fallback ONLY when `transferPlan.transferAssistant` is configured
 * (docs.vapi.ai/calls/assistant-based-warm-transfer, read 2026-10-31). The live
 * plan has had warm-transfer-experimental + fallbackPlan since 2026-09-21 but no
 * transferAssistant, so the fallback could not fire; and "Push Latest Config" kept
 * the live plan whole, so a code change never reached Vapi.
 *
 * These pin: the code-owned fields (transferAssistant, ringback holdAudioUrl,
 * fallbackPlan) ride a push over a live experimental plan that lacks them; the
 * operator-owned fields (number, plan message, mode, sipVerb, dialTimeout) stay
 * live; an operator rollback to another mode is not overridden.
 */
import { describe, expect, it } from "vitest";
import { buildAssistantConfig, preserveLiveTransferDestinations } from "./services/vapi";
import { sliceBlock } from "./testUtils/sourceBlock";

const SERVER = "https://nickstire.org/api/webhooks/vapi";

type Plan = Record<string, unknown> & {
  mode?: string;
  transferAssistant?: { firstMessage?: string; firstMessageMode?: string; model?: { messages?: Array<{ content?: string }> } };
  holdAudioUrl?: string;
  fallbackPlan?: { message?: string; endCallEnabled?: boolean };
};
type Dest = { number?: string; message?: string; transferPlan?: Plan };
const dest = (cfg: unknown): Dest =>
  ((cfg as { model: { tools: Array<{ type?: string; destinations?: Dest[] }> } }).model.tools.find((t) => t.type === "transferCall")?.destinations ?? [])[0] ?? {};

// The live plan as read 2026-10-31 12:33Z (manager dry run): experimental, dialTimeout 25,
// fallbackPlan present, NO transferAssistant, NO holdAudioUrl. Number is a test value.
const LIVE_PLAN = {
  mode: "warm-transfer-experimental",
  message: "Live counter intro.",
  sipVerb: "dial",
  dialTimeout: 25,
  fallbackPlan: { endCallEnabled: false },
};
const live = (plan: Record<string, unknown> | undefined) => [
  { type: "transferCall", destinations: [{ type: "number", number: "+12165550199", ...(plan ? { transferPlan: plan } : {}) }] },
];

describe("Push Latest Config carries the code-owned transfer fields onto the live plan", () => {
  it("(1) adds transferAssistant and holdAudioUrl to a live experimental plan that lacks them", () => {
    const cfg = preserveLiveTransferDestinations(buildAssistantConfig(SERVER), live(LIVE_PLAN));
    const d = dest(cfg);
    expect(d.transferPlan?.transferAssistant).toBeTruthy();
    expect(d.transferPlan?.holdAudioUrl).toMatch(/^https:\/\/.+\/api\/webhooks\/vapi\/ringback\.wav$/);
  });

  it("(1) keeps the live number and the operator-owned plan fields", () => {
    const d = dest(preserveLiveTransferDestinations(buildAssistantConfig(SERVER), live(LIVE_PLAN)));
    expect(d.number).toBe("+12165550199");
    expect(d.transferPlan).toMatchObject({ mode: "warm-transfer-experimental", message: "Live counter intro.", sipVerb: "dial", dialTimeout: 25 });
  });

  it("(1) a live fallbackPlan without a line gets the code's one line, still handing the caller back", () => {
    const d = dest(preserveLiveTransferDestinations(buildAssistantConfig(SERVER), live(LIVE_PLAN)));
    expect(d.transferPlan?.fallbackPlan?.endCallEnabled).toBe(false);
    expect(typeof d.transferPlan?.fallbackPlan?.message).toBe("string");
  });

  it("an operator rollback to another mode is kept whole: no experimental-only fields are forced on it", () => {
    const legacy = { mode: "warm-transfer-say-message", message: "Legacy intro.", sipVerb: "dial" };
    const d = dest(preserveLiveTransferDestinations(buildAssistantConfig(SERVER), live(legacy)));
    expect(d.transferPlan).toEqual(legacy);
  });

  it("a live destination with no plan gets the full code default (experimental with the fallback)", () => {
    const d = dest(preserveLiveTransferDestinations(buildAssistantConfig(SERVER), live(undefined)));
    expect(d.number).toBe("+12165550199");
    expect(d.transferPlan?.mode).toBe("warm-transfer-experimental");
    expect(d.transferPlan?.transferAssistant).toBeTruthy();
  });
});

describe("the code default plan (first deploy, or a live destination with no plan)", () => {
  const plan = dest(buildAssistantConfig(SERVER)).transferPlan ?? {};

  it("is warm-transfer-experimental with a transfer assistant, so no-answer can roll back", () => {
    expect(plan.mode).toBe("warm-transfer-experimental");
    expect(plan.transferAssistant?.model?.messages?.[0]?.content).toMatch(/transferCancel/);
    expect(plan.transferAssistant?.model?.messages?.[0]?.content).toMatch(/transferSuccessful/);
  });

  it("the counter hears ONE short sentence before accepting (R2)", () => {
    const first = plan.transferAssistant?.firstMessage ?? "";
    expect(plan.transferAssistant?.firstMessageMode).toBe("assistant-speaks-first");
    expect(first.split(/[.!?]\s/).length).toBeLessThanOrEqual(2);
    expect(first.length).toBeLessThanOrEqual(60);
  });

  it("the caller hears ringback, not hold music", () => {
    expect(plan.holdAudioUrl).toMatch(/\/ringback\.wav$/);
  });

  it("(4) the fallback hands the caller back with exactly one line that offers the callback", () => {
    expect(plan.fallbackPlan?.endCallEnabled).toBe(false);
    const line = plan.fallbackPlan?.message ?? "";
    expect(line).toMatch(/call you back/i);
    expect((line.match(/\?/g) ?? []).length).toBe(1);
    // Caller ID has the number (Nour, 2026-10-21): the line never asks for it.
    expect(line).not.toMatch(/number|name/i);
  });
});

describe("CALLBACK CAPTURE takes a best time and records nothing on a decline", () => {
  const prompt = (buildAssistantConfig(SERVER).model.messages[0] as { content: string }).content;
  const capture = sliceBlock(prompt, "## CALLBACK CAPTURE", "\n\n", { label: "receptionist prompt" });

  it("(4) asks when is good and passes it to escalate as bestTime", () => {
    expect(capture).toMatch(/bestTime/);
    const tools = buildAssistantConfig(SERVER).model.tools as Array<{ type?: string; function?: { name?: string; parameters?: { properties?: Record<string, unknown> } } }>;
    const escalate = tools.find((t) => t.function?.name === "escalate");
    expect(escalate?.function?.parameters?.properties).toHaveProperty("bestTime");
  });

  it("(5) a caller who says no is not escalated", () => {
    expect(capture).toMatch(/says no[^.]*do NOT escalate/i);
  });
});
