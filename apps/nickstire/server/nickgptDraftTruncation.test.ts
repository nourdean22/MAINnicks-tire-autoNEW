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
  for (const k of ["NICKGPT_OLLAMA_URL", "NICKGPT_MODEL_NAME", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "GEMINI_API_KEY", "OPENAI_API_KEY"]) {
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
      expect(res).toMatchObject({ ok: true, source: p.source, completion: "truncated" });
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
