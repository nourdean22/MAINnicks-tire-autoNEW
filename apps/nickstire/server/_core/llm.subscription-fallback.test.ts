/**
 * Ollama quota-refusal → Gemini fallback (2026-08-11).
 *
 * The incident this pins: AI_FORCE_OLLAMA=true funnels the whole estate onto
 * one usage-capped Ollama Cloud account. On 2026-08-10 the cap refused the
 * 14:00-ET daily-reel brief four times with 403 "this model requires a
 * subscription" — killing the day's reel AND silently muting the comment
 * responder — while the SAME model returned 200 the next morning. The fix
 * degrades a quota-refused call to the Gemini lane instead of going dark.
 *
 * The trap the last test guards: under AI_FORCE_OLLAMA, isOllamaModel() is
 * true for ANY model, so a naive retry through resolveApiUrl() would loop
 * straight back to the refusing Ollama lane. The retry must hard-target
 * Gemini's endpoint.
 *
 * Env hygiene per AGENTS §3: singleFork shares one process.env — every var
 * this file touches is restored-or-deleted in afterEach.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeLLM } from "./llm";

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

const SUBSCRIPTION_403 = JSON.stringify({
  error: { message: "this model requires a subscription, upgrade for access: https://ollama.com/upgrade" },
});
const OK_RESULT = { choices: [{ message: { role: "assistant", content: "ok" } }] };

function armEnv() {
  process.env.AI_FORCE_OLLAMA = "true";
  process.env.OLLAMA_API_KEY = "test-ollama-key";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.OLLAMA_MODEL;
  delete process.env.GEMINI_MODEL;
  delete process.env.OLLAMA_BASE_URL;
}

type Call = { url: string; auth: string | undefined; model: unknown };
function stubFetch(responses: Array<{ status: number; body: string }>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const parsed = JSON.parse(String(init.body));
    calls.push({ url: String(url), auth: (init.headers as Record<string, string>).authorization, model: parsed.model });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(r.body, { status: r.status, statusText: r.status === 200 ? "OK" : "Forbidden" });
  }));
  return calls;
}

describe("ollama quota refusal → gemini fallback", () => {
  it("retries a 403 subscription refusal on the Gemini endpoint and returns its result", async () => {
    armEnv();
    const calls = stubFetch([
      { status: 403, body: SUBSCRIPTION_403 },
      { status: 200, body: JSON.stringify(OK_RESULT) },
    ]);

    const result = await invokeLLM({ messages: [{ role: "user", content: "hi" }] });

    expect(result.choices?.[0]?.message?.content).toBe("ok");
    expect(calls).toHaveLength(2);
    // First call went to the forced Ollama lane with its default model.
    expect(calls[0].url).toContain("ollama.com");
    expect(calls[0].model).toBe("deepseek-v4-pro");
    // Retry hard-targets Gemini — NOT back through the flag-poisoned resolver.
    expect(calls[1].url).toContain("generativelanguage.googleapis.com");
    expect(calls[1].auth).toBe("Bearer test-gemini-key");
    expect(calls[1].model).toBe("gemini-2.5-flash");
  });

  it("a non-subscription 403 still throws the original single-lane error (one call only)", async () => {
    armEnv();
    const calls = stubFetch([{ status: 403, body: JSON.stringify({ error: { message: "invalid api key" } }) }]);

    await expect(invokeLLM({ messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(/LLM invoke failed: 403/);
    expect(calls).toHaveLength(1);
  });

  it("throws a both-lanes error when the Gemini fallback also fails", async () => {
    armEnv();
    const calls = stubFetch([
      { status: 403, body: SUBSCRIPTION_403 },
      { status: 429, body: JSON.stringify({ error: { message: "rate limited" } }) },
    ]);

    await expect(invokeLLM({ messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(/both lanes/);
    expect(calls).toHaveLength(2);
  });

  it("without GEMINI_API_KEY the refusal throws unchanged — no blind retry", async () => {
    armEnv();
    delete process.env.GEMINI_API_KEY;
    const calls = stubFetch([{ status: 403, body: SUBSCRIPTION_403 }]);

    await expect(invokeLLM({ messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(/LLM invoke failed: 403/);
    expect(calls).toHaveLength(1);
  });

  it("subscription 403 from a NATIVE ollama pin (flag off) also falls back", async () => {
    // The cap refuses by account, not by flag — a direct glm-5 pin during an
    // exhausted window deserves the same degrade.
    delete process.env.AI_FORCE_OLLAMA;
    process.env.OLLAMA_API_KEY = "test-ollama-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    delete process.env.GEMINI_MODEL;
    const calls = stubFetch([
      { status: 403, body: SUBSCRIPTION_403 },
      { status: 200, body: JSON.stringify(OK_RESULT) },
    ]);

    const result = await invokeLLM({ model: "glm-5.2:cloud", messages: [{ role: "user", content: "hi" }] });
    expect(result.choices?.[0]?.message?.content).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("generativelanguage.googleapis.com");
  });
});
