/**
 * The recap tool no longer asks the model for a phone number (job
 * 2026-10-17-vapi-followups, follow-up to the 2026-10-16 caller binding).
 *
 * Since the caller-binding PR the webhook overwrites `phone` with the number
 * on the call (routes/webhooks/vapi.ts dispatchToolCall), and refuses when the
 * call has none. The prompt and the tool schema still asked the model for a
 * phone, which is now dead input: it costs a turn asking the caller for a
 * number that is thrown away, and "IF you got a phone" made the model skip the
 * recap whenever it had not captured one, although the text would have gone
 * to the caller anyway.
 *
 * These pin the WORDING the model reads. The server-side binding is pinned by
 * routes/webhooks/vapi.recapCallId.test.ts and is unchanged.
 */
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_SYSTEM_PROMPT,
  FOLLOW_UP_SYSTEM_PROMPT,
  VAPI_TOOLS,
  buildAssistantConfig,
  buildFollowUpAssistantConfig,
} from "./vapi";

type Fn = { name?: string; description?: string; parameters?: { properties?: Record<string, unknown>; required?: string[] } };
const recapTool = (tools: unknown): Fn | undefined =>
  (tools as Array<{ function?: Fn }>).map((t) => t.function).find((f) => f?.name === "sendConfirmationSms");

/** Every prompt line that mentions the recap tool. */
const recapLines = (prompt: string) => prompt.split("\n").filter((l) => l.includes("sendConfirmationSms"));

// Each pattern is one phrasing that shipped before 2026-10-17 and asked for or
// depended on a model-supplied number.
const ASKS_FOR_PHONE = [
  /sendConfirmationSms\s*\(\s*\{\s*phone/i,
  /sendConfirmationSms\s+IF you got a phone/i,
  /if you (?:got|have) a phone/i,
  /with their phone/i,
];

describe("the recap tool schema", () => {
  for (const [label, tools] of [
    ["inbound receptionist (VAPI_TOOLS)", VAPI_TOOLS],
    ["inbound config as pushed", (buildAssistantConfig() as { model?: { tools?: unknown } }).model?.tools],
    ["outbound follow-up config as pushed", (buildFollowUpAssistantConfig() as { model?: { tools?: unknown } }).model?.tools],
  ] as const) {
    it(`${label}: offers no phone argument and requires only the summary`, () => {
      const fn = recapTool(tools);
      // Positive control: the tool is there, so the absences below are real.
      expect(fn).toBeDefined();
      expect(fn?.parameters?.properties).toHaveProperty("summary");
      expect(fn?.parameters?.properties).not.toHaveProperty("phone");
      expect(fn?.parameters?.required).toEqual(["summary"]);
      expect(fn?.description).not.toMatch(/when you have a phone/i);
    });
  }
});

describe("the prompts", () => {
  for (const [label, prompt] of [
    ["inbound receptionist", ASSISTANT_SYSTEM_PROMPT],
    ["outbound follow-up", FOLLOW_UP_SYSTEM_PROMPT],
  ] as const) {
    it(`${label}: no line about the recap asks for or depends on a phone number`, () => {
      const lines = recapLines(prompt);
      // Positive control: the prompt still tells the model to send the recap.
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) for (const re of ASKS_FOR_PHONE) expect(line).not.toMatch(re);
    });
  }

  it("inbound: the tool line says where the text goes", () => {
    const toolLine = recapLines(ASSISTANT_SYSTEM_PROMPT).find((l) => l.startsWith("· sendConfirmationSms"));
    expect(toolLine).toBeDefined();
    expect(toolLine).toMatch(/sendConfirmationSms\(\{ summary \}\)/);
    expect(toolLine).toMatch(/calling from/i);
  });
});
