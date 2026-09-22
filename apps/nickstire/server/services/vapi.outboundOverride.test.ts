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
 * Read from the Railway deploy log, 2026-09-19 14:50Z. Every voice-recovery
 * dial since 2026-06-18 — 110 of 110 — ended this way, and each one burned
 * its lead; the other half of that defect is pinned in
 * `cron/jobs/voiceRecovery.dialFailure.test.ts`.
 *
 * WHAT THIS PINS — the request BODY that reaches `fetch`, not a re-typed copy
 * of it. With an override, the model block carries provider + model + the
 * override as its system message and is otherwise IDENTICAL to the block the
 * follow-up assistant is defined with (one helper builds both, so the outcome
 * does not depend on how Vapi merges overrides). And the `errorKind` each
 * failure exit reports, which the cron branches on.
 *
 * POSITIVE CONTROL. Without an override NO model block is sent at all — the
 * cadence lane relies on the assistant's base prompt plus variableValues, and
 * an accidental full block there would silently replace its prompt.
 *
 * SYNTHETIC ONLY — fetch is stubbed, numbers are 555, env pins are canaries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Captured = { url: string; body: Record<string, unknown> } | null;
type Overrides = { model?: Record<string, unknown>; variableValues?: Record<string, string> };

describe("placeVapiOutboundCall · assistantOverrides.model", () => {
  let captured: Captured = null;
  let respond: () => Response = () =>
    new Response(JSON.stringify({ id: "call_ok" }), { status: 201, headers: { "content-type": "application/json" } });

  beforeEach(() => {
    vi.resetModules();
    captured = null;
    respond = () => new Response(JSON.stringify({ id: "call_ok" }), { status: 201 });
    vi.stubEnv("VAPI_API_KEY", "canary-key");
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
    // Short-circuits resolveVapiPhoneNumberId's /phone-number lookup.
    vi.stubEnv("VAPI_PHONE_NUMBER_ID", "pn_canary");
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
      return respond();
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const overridesOf = (c: Captured): Overrides => (c?.body.assistantOverrides ?? {}) as Overrides;

  it("with a prompt override: provider + model are present and the override is the system message", async () => {
    const { placeVapiOutboundCall, followUpModelBlock } = await import("./vapi");
    const r = await placeVapiOutboundCall({
      customerNumber: "+12165550142",
      systemPromptOverride: "RECOVERY PROMPT",
      firstMessageOverride: "hi there",
      voicemailMessage: "vm",
    });
    expect(r).toEqual({ success: true, callId: "call_ok" });
    expect(captured?.url).toBe("https://api.vapi.ai/call");

    const model = overridesOf(captured).model as Record<string, unknown>;
    // The two fields Vapi's OpenAIModel schema marks REQUIRED. The pre-fix
    // shape had neither — that absence was the whole 400.
    expect(model.provider).toBe("openai");
    expect(model.model).toBe("gpt-4o");
    expect(model.messages).toEqual([{ role: "system", content: "RECOVERY PROMPT" }]);

    // Prompt aside, byte-for-byte the block the assistant is defined with.
    const { messages: _sent, ...sentRest } = model;
    const { messages: _own, ...ownRest } = JSON.parse(JSON.stringify(followUpModelBlock())) as Record<string, unknown>;
    expect(sentRest).toEqual(ownRest);
    const toolNames = (model.tools as Array<{ function?: { name?: string } }>).map((t) => t.function?.name).sort();
    expect(toolNames).toEqual(["escalate", "sendConfirmationSms"]);
  });

  it("POSITIVE CONTROL: without an override no model block is sent — the cadence lane keeps its base prompt", async () => {
    const { placeVapiOutboundCall } = await import("./vapi");
    const r = await placeVapiOutboundCall({ customerNumber: "+12165550142", variableValues: { name: "Pat" } });
    expect(r.success).toBe(true);
    const o = overridesOf(captured);
    expect(o).not.toHaveProperty("model");
    expect(o.variableValues).toEqual({ name: "Pat" });
  });

  it("errorKind · provider — a non-2xx from Vapi (the exact 400 the lane received for three months)", async () => {
    respond = () =>
      new Response(
        JSON.stringify({ message: ["assistantOverrides.model.provider must be one of the following values: openai, azure-openai"] }),
        { status: 400 },
      );
    const { placeVapiOutboundCall } = await import("./vapi");
    const r = await placeVapiOutboundCall({ customerNumber: "+12165550142", systemPromptOverride: "x" });
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe("provider");
    expect(r.error).toContain("VAPI /call returned 400");
  });

  it("errorKind · network — fetch itself throws", async () => {
    respond = () => {
      throw new Error("ECONNRESET (canary)");
    };
    const { placeVapiOutboundCall } = await import("./vapi");
    const r = await placeVapiOutboundCall({ customerNumber: "+12165550142", systemPromptOverride: "x" });
    expect(r).toEqual({ success: false, error: "ECONNRESET (canary)", errorKind: "network" });
  });

  it("errorKind · customer — a number that is not E.164 never reaches fetch", async () => {
    const { placeVapiOutboundCall } = await import("./vapi");
    const r = await placeVapiOutboundCall({ customerNumber: "216-555-0142", systemPromptOverride: "x" });
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe("customer");
    expect(captured).toBeNull();
  });

  it("errorKind · config — no follow-up assistant pinned never reaches fetch", async () => {
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "");
    const { placeVapiOutboundCall } = await import("./vapi");
    const r = await placeVapiOutboundCall({ customerNumber: "+12165550142", systemPromptOverride: "x" });
    expect(r).toEqual({ success: false, error: "VAPI_FOLLOWUP_ASSISTANT_ID env not set", errorKind: "config" });
    expect(captured).toBeNull();
  });
});
