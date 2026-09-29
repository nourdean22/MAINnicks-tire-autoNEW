/**
 * Q-44 · the Claude fallback of the SMS drafter defaulted to
 * claude-3-5-haiku-latest, retired 2026-02-19, so with ANTHROPIC_MODEL unset
 * every Claude attempt since failed and fell through to the next provider. This pins the request that
 * actually goes over the wire: a current model, no temperature (current Claude
 * models reject it), thinking off (it would eat the 110-token draft budget),
 * and the draft read from the text block, not content[0].
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./services/businessFacts", () => ({ buildWarrantyFactsPreambleLive: async () => "" }));

import { draftSmsReply } from "./services/nickgpt-client";

describe("draftSmsReply · Claude fallback request", () => {
  beforeEach(() => {
    vi.stubEnv("NICKGPT_OLLAMA_URL", ""); // NickGPT path off → straight to the fallback
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic");
    vi.stubEnv("ANTHROPIC_MODEL", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the current default model, no temperature, thinking disabled; reads the text block", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "  Yes, we have 2 in stock.  " }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await draftSmsReply({ inboundMessage: "do you have 225/65R17?" });

    expect(res).toMatchObject({ ok: true, draft: "Yes, we have 2 in stock.", source: "fallback-claude", modelName: "claude-sonnet-5" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-sonnet-5");
    expect(body).not.toHaveProperty("temperature");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.max_tokens).toBe(110);
  });

  it("an operator ANTHROPIC_MODEL override still wins", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-haiku-4-5");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await draftSmsReply({ inboundMessage: "hi" });
    expect(res).toMatchObject({ ok: true, modelName: "claude-haiku-4-5" });
  });

  // 2026-09-29 · `thinking: disabled` is a 400 on Opus 5.5, Sonnet 5.5 and
  // Fable/Mythos (claude-api skill thinking table). The wire body must carry
  // the form each model accepts, or an ANTHROPIC_MODEL flip kills the lane.
  it.each([
    ["claude-sonnet-5", { thinking: { type: "disabled" } }],
    ["claude-opus-5", { thinking: { type: "disabled" } }],
    ["claude-opus-4-8", { thinking: { type: "disabled" } }],
    ["claude-haiku-4-5-20251001", { thinking: { type: "disabled" } }],
    ["claude-sonnet-5-5", { thinking: { type: "between_tools" } }],
    ["claude-opus-5-5", { output_config: { effort: "low" } }],
    ["claude-fable-5-1", { output_config: { effort: "low" } }],
    ["claude-fable-5", { output_config: { effort: "low" } }],
    ["claude-mythos-5-1", { output_config: { effort: "low" } }],
  ])("ANTHROPIC_MODEL=%s sends the thinking-off form it accepts", async (model, expected) => {
    vi.stubEnv("ANTHROPIC_MODEL", model);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await draftSmsReply({ inboundMessage: "hi" });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe(model);
    expect(body).not.toHaveProperty("temperature");
    const sent = { thinking: body.thinking, output_config: body.output_config };
    expect(sent).toEqual({ thinking: undefined, output_config: undefined, ...expected });
  });

  it("positive control: an id no table names never gets `disabled` (it could 400)", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-opus-6");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await draftSmsReply({ inboundMessage: "hi" });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty("thinking");
    expect(body.output_config).toEqual({ effort: "low" });
  });

  it("a non-OK Anthropic response yields no draft (the retired-model failure shape)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"type":"error"}', { status: 404 })));
    const res = await draftSmsReply({ inboundMessage: "hi" });
    expect(res).toEqual({
      ok: false,
      error: "All fallback LLM providers failed or no keys configured.",
      source: "fallback-claude",
    });
  });
});
