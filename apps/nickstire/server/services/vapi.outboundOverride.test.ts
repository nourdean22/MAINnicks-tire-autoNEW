/**
 * placeVapiOutboundCall · a prompt override is a COMPLETE model block (2026-09-22)
 *
 * WHAT WAS WRONG. With `systemPromptOverride` set, the request carried
 * `assistantOverrides.model = { messages: [...] }`. Vapi's schema makes that
 * field a oneOf over its full model DTOs (OpenAIModel, AnthropicModel, …),
 * each of which REQUIRES `provider` and `model`, so the API rejected the call
 * before it existed:
 *
 *   400 "assistantOverrides.model.provider must be one of the following
 *        values: openai, azure-openai, together-ai, anyscale, openrouter, …"
 *
 * Read from the Railway deploy log, 2026-09-19 14:50Z. The shape dated from
 * wave-143 (2026-05-29); every voice-recovery dial since 2026-06-18 — 110 of
 * 110 — ended this way, and each one burned its lead. That half is pinned in
 * `cron/jobs/voiceRecovery.dialFailure.test.ts`.
 *
 * WHAT THIS PINS — two request BODIES that reach `fetch`, compared to each
 * other, never to a re-typed copy: the model block the follow-up assistant is
 * DEFINED with (the PATCH body of updateFollowUpAssistant) and the model block
 * a prompt override SENDS (the POST /call body). Prompt aside they must be
 * identical, which is what makes the dial independent of how Vapi merges
 * overrides. Plus the `errorKind` each failure exit reports — the cron
 * branches on it — and that the customer-kind message masks the digits,
 * because it travels into cron_log.details.
 *
 * Q-45 (2026-09-23) CHANGED ONE CONTRACT HERE, deliberately. This file used to
 * pin that a call WITHOUT a prompt override sends no model block, so the
 * cadence lane ran on the live assistant's base prompt. That is exactly what
 * let the lane open with a bare "{{name}}?" — no business name first, no
 * callback number, no opt-out (47 CFR 64.1200(b)). Every call now sends a
 * complete block carrying the do-not-call tool and instruction, so the old
 * positive control is replaced by one proving the cadence lane's block holds
 * the trust-call prompt, filled for the customer.
 *
 * SYNTHETIC ONLY — fetch is stubbed, numbers are 555, env pins are canaries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Captured = { url: string; method: string; body: Record<string, unknown> } | null;
type Overrides = { model?: Record<string, unknown>; variableValues?: Record<string, string> };

describe("placeVapiOutboundCall · assistantOverrides.model", () => {
  let captured: Captured = null;
  let respond: () => Response = () => new Response(JSON.stringify({ id: "call_ok" }), { status: 201 });

  beforeEach(() => {
    vi.resetModules();
    captured = null;
    respond = () => new Response(JSON.stringify({ id: "call_ok" }), { status: 201 });
    vi.stubEnv("VAPI_API_KEY", "canary-key");
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
    // Short-circuits resolveVapiPhoneNumberId's /phone-number lookup.
    vi.stubEnv("VAPI_PHONE_NUMBER_ID", "pn_canary");
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      captured = {
        url: String(url),
        method: String(init?.method ?? "GET"),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      };
      return respond();
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const overridesOf = (c: Captured): Overrides => (c?.body.assistantOverrides ?? {}) as Overrides;
  const withoutMessages = (block: Record<string, unknown>) => {
    const { messages: _m, ...rest } = block;
    return rest;
  };

  it("with a prompt override: provider + model are present, the override is the system message, and the block is the assistant's own", async () => {
    const { placeVapiOutboundCall, updateFollowUpAssistant } = await import("./vapi");

    // The block the assistant is DEFINED with — read off the real PATCH body.
    const patched = await updateFollowUpAssistant("asst_canary");
    expect(patched).toEqual({ success: true });
    expect(captured?.url).toBe("https://api.vapi.ai/assistant/asst_canary");
    expect(captured?.method).toBe("PATCH");
    const definedModel = captured!.body.model as Record<string, unknown>;
    expect(definedModel.provider).toBe("openai");

    captured = null;
    const r = await placeVapiOutboundCall({
      customerNumber: "+12165550142",
      lane: "voice_recovery",
      customerName: "Pat",
      openerBody: "hi there",
      systemPrompt: "RECOVERY PROMPT",
    });
    expect(r).toEqual({ success: true, callId: "call_ok" });
    expect(captured?.url).toBe("https://api.vapi.ai/call");
    expect(captured?.method).toBe("POST");

    const sentModel = overridesOf(captured).model as Record<string, unknown>;
    // The two fields Vapi's OpenAIModel schema marks REQUIRED. The pre-fix
    // shape had neither — that absence was the whole 400.
    expect(sentModel.provider).toBe("openai");
    expect(sentModel.model).toBe("gpt-4o");
    const { OUTBOUND_COMPLIANCE_PROMPT } = await import("./outboundCallCompliance");
    expect(sentModel.messages).toEqual([{ role: "system", content: `RECOVERY PROMPT\n\n${OUTBOUND_COMPLIANCE_PROMPT}` }]);
    // Prompt aside, byte-for-byte what the assistant itself is defined with.
    expect(withoutMessages(sentModel)).toEqual(withoutMessages(definedModel));
    const toolNames = (sentModel.tools as Array<{ function?: { name?: string } }>).map((t) => t.function?.name).sort();
    expect(toolNames).toEqual(["endOnVoicemail", "escalate", "recordDoNotCall", "sendConfirmationSms"]);
  });

  it("POSITIVE CONTROL: the cadence lane's block carries the trust-call prompt, filled for this customer", async () => {
    const { placeVapiOutboundCall, buildFollowUpCallContent, FOLLOW_UP_SYSTEM_PROMPT } = await import("./vapi");
    const content = buildFollowUpCallContent({ customerName: "Pat", lastService: "brake job" });
    const r = await placeVapiOutboundCall({
      customerNumber: "+12165550142",
      lane: "followup_cadence",
      customerName: "Pat",
      ...content,
      variableValues: { name: "Pat" },
    });
    expect(r.success).toBe(true);
    const o = overridesOf(captured);
    const system = String((o.model?.messages as Array<{ content: string }>)[0]?.content);
    // The trust-call prompt's own opening line, filled — not some other prompt.
    expect(FOLLOW_UP_SYSTEM_PROMPT).toContain("Outbound follow-up to {{name}} after their {{lastService}}.");
    expect(system).toContain("Outbound follow-up to Pat after their brake job.");
    expect(system).not.toContain("{{");
    expect(o.variableValues).toEqual({ name: "Pat" });
  });

  it("errorKind · provider — a non-2xx from Vapi (the exact 400 the lane received for three months)", async () => {
    respond = () =>
      new Response(
        JSON.stringify({ message: ["assistantOverrides.model.provider must be one of the following values: openai, azure-openai"] }),
        { status: 400 },
      );
    const { placeVapiOutboundCall } = await import("./vapi");
    const r = await placeVapiOutboundCall({ customerNumber: "+12165550142", lane: "voice_recovery", openerBody: "x", systemPrompt: "x" });
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe("provider");
    expect(r.error).toContain("VAPI /call returned 400");
  });

  it("errorKind · network — fetch itself throws", async () => {
    respond = () => {
      throw new Error("ECONNRESET (canary)");
    };
    const { placeVapiOutboundCall } = await import("./vapi");
    const r = await placeVapiOutboundCall({ customerNumber: "+12165550142", lane: "voice_recovery", openerBody: "x", systemPrompt: "x" });
    expect(r).toEqual({ success: false, error: "ECONNRESET (canary)", errorKind: "network" });
  });

  it("errorKind · customer — a number that is not E.164 never reaches fetch, and the message carries no digits", async () => {
    const { placeVapiOutboundCall } = await import("./vapi");
    const r = await placeVapiOutboundCall({ customerNumber: "216-555-0142", lane: "voice_recovery", openerBody: "x", systemPrompt: "x" });
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe("customer");
    expect(captured).toBeNull();
    // The message travels into cron_log.details: the shape is enough, the digits never leave.
    expect(r.error).toBe("Invalid customerNumber: not E.164 (shape ###-###-####)");
  });

  it("errorKind · config — no follow-up assistant pinned never reaches fetch", async () => {
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "");
    const { placeVapiOutboundCall } = await import("./vapi");
    const r = await placeVapiOutboundCall({ customerNumber: "+12165550142", lane: "voice_recovery", openerBody: "x", systemPrompt: "x" });
    expect(r).toEqual({ success: false, error: "VAPI_FOLLOWUP_ASSISTANT_ID env not set", errorKind: "config" });
    expect(captured).toBeNull();
  });
});
