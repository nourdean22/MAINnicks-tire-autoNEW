/**
 * Vision reroute — image parts must never ride the Ollama lane (2026-08-11).
 *
 * The incident this pins: AI_FORCE_OLLAMA=true routed the rendered-QA vision
 * critic's frames to deepseek-v4-pro, which rejects images (probed live:
 * 400 "this model does not support image input"). Every verdict since
 * 2026-08-06 came back critic:"skipped" → qaState "unavailable" → the publish
 * gate held every autonomous reel. Image-bearing calls now route to Gemini up
 * front; text-only calls are untouched.
 *
 * Env hygiene per AGENTS §3: singleFork shares one process.env — every var
 * this file touches is restored-or-deleted in afterEach.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeLLM, type Message } from "./llm";

const TOUCHED = [
  "AI_FORCE_OLLAMA", "AI_FORCE_GEMINI", "OLLAMA_MODEL", "OLLAMA_API_KEY",
  "OLLAMA_BASE_URL", "GEMINI_API_KEY", "GEMINI_MODEL", "OPENAI_API_KEY", "LLM_MODEL",
] as const;
const orig: Record<string, string | undefined> = {};
for (const k of TOUCHED) orig[k] = process.env[k];

afterEach(() => {
  for (const k of TOUCHED) {
    if (orig[k] === undefined) delete process.env[k];
    else process.env[k] = orig[k];
  }
  vi.unstubAllGlobals();
});

const OK = JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] });
const IMG_MESSAGES: Message[] = [{
  role: "user",
  content: [
    { type: "text", text: "judge these frames" },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
  ],
}];

type Call = { url: string; auth: string | undefined; model: unknown; body: Record<string, unknown> };
function stubFetch(responses: Array<{ status: number; body: string }>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const parsed = JSON.parse(String(init.body));
    calls.push({ url: String(url), auth: (init.headers as Record<string, string>).authorization, model: parsed.model, body: parsed });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(r.body, { status: r.status });
  }));
  return calls;
}

function armForceOllama() {
  process.env.AI_FORCE_OLLAMA = "true";
  process.env.OLLAMA_API_KEY = "test-ollama-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.OLLAMA_MODEL;
  delete process.env.GEMINI_MODEL;
  delete process.env.OLLAMA_BASE_URL;
}

describe("vision reroute off the ollama lane", () => {
  it("image parts under AI_FORCE_OLLAMA go straight to Gemini — ONE call, never Ollama", async () => {
    armForceOllama();
    const calls = stubFetch([{ status: 200, body: OK }]);

    const res = await invokeLLM({ messages: IMG_MESSAGES });

    expect(res.choices?.[0]?.message?.content).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("generativelanguage.googleapis.com");
    expect(calls[0].auth).toBe("Bearer test-gemini-key");
    expect(calls[0].model).toBe("gemini-2.5-flash");
  });

  it("text-only under AI_FORCE_OLLAMA still rides the Ollama lane (unchanged)", async () => {
    armForceOllama();
    const calls = stubFetch([{ status: 200, body: OK }]);

    await invokeLLM({ messages: [{ role: "user", content: "hi" }] });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("ollama.com");
    expect(calls[0].model).toBe("deepseek-v4-pro");
  });

  it("a NATIVE ollama pin with image parts (flag off) also reroutes — the lane rejects images regardless of the flag", async () => {
    delete process.env.AI_FORCE_OLLAMA;
    process.env.OLLAMA_API_KEY = "test-ollama-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    delete process.env.GEMINI_MODEL;
    const calls = stubFetch([{ status: 200, body: OK }]);

    await invokeLLM({ model: "glm-5.2:cloud", messages: IMG_MESSAGES });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("generativelanguage.googleapis.com");
  });

  it("without GEMINI_API_KEY the original routing is preserved — an honest failure beats a blind reroute", async () => {
    process.env.AI_FORCE_OLLAMA = "true";
    process.env.OLLAMA_API_KEY = "test-ollama-key";
    delete process.env.GEMINI_API_KEY;
    delete process.env.OLLAMA_MODEL;
    const calls = stubFetch([
      { status: 400, body: JSON.stringify({ error: { message: "this model does not support image input" } }) },
    ]);

    await expect(invokeLLM({ messages: IMG_MESSAGES })).rejects.toThrow(/LLM invoke failed: 400/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("ollama.com");
  });

  it("CONTROL: without reasoningEffort the rerouted body carries no reasoning_effort (byte-identical to before)", async () => {
    armForceOllama();
    const calls = stubFetch([{ status: 200, body: OK }]);
    await invokeLLM({ messages: IMG_MESSAGES });
    expect(calls[0].body).not.toHaveProperty("reasoning_effort");
  });

  it("a failed rerouted call throws plainly — it is never bounced back through the 403-subscription fallback", async () => {
    armForceOllama();
    const calls = stubFetch([
      { status: 403, body: JSON.stringify({ error: { message: "subscription required" } }) },
    ]);

    await expect(invokeLLM({ messages: IMG_MESSAGES })).rejects.toThrow(/LLM invoke failed: 403/);
    expect(calls).toHaveLength(1); // one Gemini call, no second hop
    expect(calls[0].url).toContain("generativelanguage.googleapis.com");
  });
});

// 2026-10-08 15:31Z: the rendered-QA critic's 4096 budget came back
// finish_reason=length after 573 visible characters — Gemini 2.5 spends its
// thinking out of max_tokens. reasoning_effort bounds that thinking, and it is
// Google's field: it must reach Google's endpoint and nothing else.
describe("reasoning_effort rides only a request that goes to Google's endpoint", () => {
  it("the vision reroute carries it", async () => {
    armForceOllama();
    const calls = stubFetch([{ status: 200, body: OK }]);
    await invokeLLM({ messages: IMG_MESSAGES, reasoningEffort: "medium" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("generativelanguage.googleapis.com");
    expect(calls[0].body.reasoning_effort).toBe("medium");
  });

  it("a text call on the Ollama lane never carries it, even when the caller asked", async () => {
    armForceOllama();
    const calls = stubFetch([{ status: 200, body: OK }]);
    await invokeLLM({ messages: [{ role: "user", content: "hi" }], reasoningEffort: "medium" });
    expect(calls[0].url).toContain("ollama.com");
    expect(calls[0].body).not.toHaveProperty("reasoning_effort");
  });

  it("the 403-quota fallback to Gemini carries it; the refused Ollama attempt did not", async () => {
    armForceOllama();
    const calls = stubFetch([
      { status: 403, body: JSON.stringify({ error: { message: "this model requires a subscription" } }) },
      { status: 200, body: OK },
    ]);
    await invokeLLM({ messages: [{ role: "user", content: "hi" }], reasoningEffort: "low" });
    expect(calls).toHaveLength(2);
    expect(calls[0].body).not.toHaveProperty("reasoning_effort");
    expect(calls[1].url).toContain("generativelanguage.googleapis.com");
    expect(calls[1].body.reasoning_effort).toBe("low");
  });

  it("a direct gemini-* model carries it; a direct OpenAI model never does", async () => {
    delete process.env.AI_FORCE_OLLAMA;
    delete process.env.AI_FORCE_GEMINI;
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    const calls = stubFetch([{ status: 200, body: OK }]);
    await invokeLLM({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "hi" }], reasoningEffort: "high" });
    await invokeLLM({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }], reasoningEffort: "high" });
    expect(calls[0].url).toContain("generativelanguage.googleapis.com");
    expect(calls[0].body.reasoning_effort).toBe("high");
    expect(calls[1].url).toContain("api.openai.com");
    expect(calls[1].body).not.toHaveProperty("reasoning_effort");
  });
});
