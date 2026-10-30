/**
 * F4a · every drafting provider's truncation signal is read.
 *
 * DEFAULT_MAX_TOKENS is ~one SMS. A draft that hit it was cut mid-sentence and,
 * before this fix, came back as `{ ok: true, draft }` exactly like a finished one,
 * so the auto-send path could text a customer half a sentence. Each provider
 * reports why it stopped:
 *   Ollama /api/chat         done_reason              "stop"     | "length"
 *   Anthropic /v1/messages   stop_reason              "end_turn" | "max_tokens"
 *   Gemini (OpenAI-compat)   choices[0].finish_reason "stop"     | "length"
 *   OpenAI chat completions  choices[0].finish_reason "stop"     | "length"
 * Only `completion: "complete"` is auto-sendable. For each provider the
 * finished signal is the positive control; a missing signal must read "unknown".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./services/businessFacts", () => ({ buildWarrantyFactsPreambleLive: async () => "" }));
vi.mock("./services/featureFlags", () => ({ isEnabled: async () => true }));

import { draftSmsReply } from "./services/nickgpt-client";

const CUT = "Yes we do alignments on trucks, we can usually get you in the same day if you";
const DONE = "Yes, we do alignments on trucks. Want to bring it by?";

type Provider = {
  name: string;
  env: Record<string, string>;
  source: string;
  body: (text: string, reason: string | undefined) => unknown;
  truncated: string;
  finished: string;
};

const PROVIDERS: Provider[] = [
  {
    name: "Ollama (NickGPT)",
    env: { NICKGPT_OLLAMA_URL: "http://ollama.test", NICKGPT_MODEL_NAME: "nickgpt-test" },
    source: "nickgpt-ollama",
    body: (text, reason) => ({ message: { role: "assistant", content: text }, done: true, ...(reason ? { done_reason: reason } : {}) }),
    truncated: "length",
    finished: "stop",
  },
  {
    name: "Anthropic",
    env: { ANTHROPIC_API_KEY: "test-anthropic" },
    source: "fallback-claude",
    body: (text, reason) => ({ content: [{ type: "text", text }], ...(reason ? { stop_reason: reason } : {}) }),
    truncated: "max_tokens",
    finished: "end_turn",
  },
  {
    name: "Gemini (OpenAI-compatible)",
    env: { GEMINI_API_KEY: "test-gemini" },
    source: "fallback-openai",
    body: (text, reason) => ({ choices: [{ index: 0, message: { role: "assistant", content: text }, ...(reason ? { finish_reason: reason } : {}) }] }),
    truncated: "length",
    finished: "stop",
  },
  {
    name: "OpenAI",
    env: { OPENAI_API_KEY: "test-openai" },
    source: "fallback-openai",
    body: (text, reason) => ({ choices: [{ index: 0, message: { role: "assistant", content: text }, ...(reason ? { finish_reason: reason } : {}) }] }),
    truncated: "length",
    finished: "stop",
  },
];

function stubProvider(p: Provider, text: string, reason: string | undefined) {
  for (const k of ["NICKGPT_OLLAMA_URL", "NICKGPT_MODEL_NAME", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "GEMINI_API_KEY", "OPENAI_API_KEY", "AI_FORCE_OLLAMA"]) {
    vi.stubEnv(k, "");
  }
  for (const [k, v] of Object.entries(p.env)) vi.stubEnv(k, v);
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(p.body(text, reason)), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("draftSmsReply · F4a provider truncation signals", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe.each(PROVIDERS)("$name", (p) => {
    it("a draft cut at the token cap is flagged truncated — not auto-sendable", async () => {
      const fetchMock = stubProvider(p, CUT, p.truncated);
      const res = await draftSmsReply({ inboundMessage: "do you do alignments on trucks" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res).toMatchObject({ ok: true, source: p.source, completion: "truncated", finishReason: p.truncated });
    });

    it("positive control: the finished signal is complete", async () => {
      stubProvider(p, DONE, p.finished);
      const res = await draftSmsReply({ inboundMessage: "do you do alignments on trucks" });
      expect(res).toMatchObject({ ok: true, draft: DONE, source: p.source, completion: "complete" });
    });

    it("no stop signal at all reads unknown, never complete", async () => {
      stubProvider(p, DONE, undefined);
      const res = await draftSmsReply({ inboundMessage: "do you do alignments on trucks" });
      expect(res).toMatchObject({ ok: true, completion: "unknown" });
    });
  });
});

// 2026-10-30 · Gemini 3 cannot turn thinking off, and its thinking tokens count
// against max_tokens. With the bare 110-token SMS cap, 22 of 23 October drafts
// came back cut to a few words. The Gemini call must ask for the lowest thinking
// level and leave room above the SMS budget; length stays enforced downstream
// (nickgptPreflightGuard: > 320 chars to review, > 480 blocked).
describe("draftSmsReply · Gemini leaves room for thinking", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const gemini = PROVIDERS[2];
  const openai = PROVIDERS[3];
  const sentBody = (fetchMock: ReturnType<typeof stubProvider>) => {
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    return { url, body: JSON.parse(init.body) };
  };

  it("asks for minimal thinking and a token cap well above the SMS budget, on the documented endpoint", async () => {
    const fetchMock = stubProvider(gemini, DONE, "stop");
    await draftSmsReply({ inboundMessage: "do you do alignments on trucks", maxTokens: 110 });
    const { url, body } = sentBody(fetchMock);
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(body.reasoning_effort).toBe("minimal");
    expect(body.max_tokens).toBeGreaterThanOrEqual(110 + 1024);
  });

  it("positive control: the OpenAI path keeps the plain SMS cap and sends no reasoning field", async () => {
    const fetchMock = stubProvider(openai, DONE, "stop");
    await draftSmsReply({ inboundMessage: "do you do alignments on trucks", maxTokens: 110 });
    const { body } = sentBody(fetchMock);
    expect(body.max_tokens).toBe(110);
    expect(body).not.toHaveProperty("reasoning_effort");
  });
});

describe("draftSmsReply · stop reasons that are neither finished nor the cap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const anthropic = PROVIDERS[1];
  const openai = PROVIDERS[3];

  it.each([
    { p: anthropic, reason: "stop_sequence", expected: "complete" },
    { p: anthropic, reason: "model_context_window_exceeded", expected: "truncated" },
    { p: anthropic, reason: "refusal", expected: "unknown" },
    { p: anthropic, reason: "pause_turn", expected: "unknown" },
    { p: openai, reason: "content_filter", expected: "unknown" },
    { p: openai, reason: "tool_calls", expected: "unknown" },
    { p: PROVIDERS[0], reason: "load", expected: "unknown" },
  ])("$p.name $reason -> $expected", async ({ p, reason, expected }) => {
    stubProvider(p, DONE, reason);
    const res = await draftSmsReply({ inboundMessage: "do you do alignments on trucks" });
    expect(res).toMatchObject({ ok: true, completion: expected });
  });
});
