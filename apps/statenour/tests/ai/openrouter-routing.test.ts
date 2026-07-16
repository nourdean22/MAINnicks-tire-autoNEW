/**
 * Regression · OpenRouter routing (2026-07-04 chat-pipeline audit P2).
 *
 * Two confirmed defects behind the prod poison-pill incident's blast
 * radius:
 *
 * 1. createOpenRouterModel used the @ai-sdk/openai provider CALLABLE,
 *    which in v3 defaults to the RESPONSES API — every OpenRouter chat
 *    request posted to openrouter.ai/api/v1/responses, whose strict zod
 *    validator produced the live invalid_prompt/invalid_union 400s.
 *    Pinned here: the model getModel() builds for the openrouter lane is
 *    a Chat Completions model, never a Responses model.
 *
 * 2. inferProviderName had no openrouter branch, and OpenRouter's
 *    vendor-prefixed ids ("google/gemini-2.5-flash") matched the gemini
 *    substring check — so a failing OpenRouter was never failure-marked
 *    (re-picked on every retry) while the HEALTHY native gemini lane got
 *    banned in its place. Pinned here: the slash prefix resolves to
 *    "openrouter" and native ids keep their providers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inferProviderName } from "@/lib/ai/stream-with-fallback";
import { getModel } from "@/lib/ai/provider";

const savedKey = process.env.OPENROUTER_API_KEY;
const savedOllamaKey = process.env.OLLAMA_API_KEY;

beforeAll(() => {
  // Make the openrouter lane the one getModel() selects. Since the
  // 2026-07-12 repoint, ollama is FIRST in every TASK_ROUTING_PREFERENCES
  // entry (openrouter second) — and lib/prisma.ts's loadEnvConfig() pulls
  // .env into process.env for any test that transitively imports it, so on
  // a dev machine with a real OLLAMA_API_KEY the ollama lane would win and
  // this test would assert against the wrong provider. Remove ollama from
  // contention explicitly: this test pins the OPENROUTER lane's regressions
  // (Responses-API 400s + failure-marking misattribution), not routing order.
  delete process.env.OLLAMA_API_KEY;
  process.env.OPENROUTER_API_KEY = "sk-or-test-not-a-real-key";
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
  if (savedOllamaKey === undefined) delete process.env.OLLAMA_API_KEY;
  else process.env.OLLAMA_API_KEY = savedOllamaKey;
});

describe("inferProviderName · openrouter recognition", () => {
  it("resolves vendor-prefixed OpenRouter ids to 'openrouter' (never the native vendor)", () => {
    expect(inferProviderName({ modelId: "google/gemini-2.5-flash" })).toBe("openrouter");
    expect(inferProviderName({ modelId: "openai/gpt-4o" })).toBe("openrouter");
    expect(inferProviderName({ modelId: "anthropic/claude-3.5-sonnet" })).toBe("openrouter");
  });

  it("keeps native (un-prefixed) ids on their own providers", () => {
    expect(inferProviderName({ modelId: "gemini-3.5-flash" })).toBe("gemini");
    expect(inferProviderName({ modelId: "gpt-4o" })).toBe("openai");
    expect(inferProviderName({ modelId: "claude-3-5-sonnet-latest" })).toBe("anthropic");
    expect(inferProviderName({ modelId: "gpt-oss:120b-ollama" })).toBe("ollama");
  });

  it("prefix exceptions stay native: models/ (Google form) and provider-name prefixes", () => {
    // Google's native API id form — must NOT be claimed by openrouter.
    expect(inferProviderName({ modelId: "models/gemini-2.5-flash" })).toBe("gemini");
    // Provider-name-prefixed shapes (telemetry/fixtures) keep their lanes.
    expect(inferProviderName({ modelId: "gemini/gemini-3.5-flash" })).toBe("gemini");
    expect(inferProviderName({ modelId: "ollama/qwen3-235b" })).toBe("ollama");
  });
});

describe("getModel · openrouter lane uses Chat Completions, not the Responses API", () => {
  it("builds a chat-completions model for the openrouter-first task routing", () => {
    const model = getModel("fast") as { provider?: string; modelId?: string };
    // The lane must be openrouter (vendor-prefixed default model)...
    expect(model.modelId ?? "").toContain("/");
    // ...and the instance must be the Chat Completions flavor. The bare
    // createOpenAI callable returns provider "openai.responses" (the
    // strict endpoint that 400'd in prod); .chat() returns "openai.chat".
    expect(model.provider ?? "").not.toContain("responses");
    expect(model.provider ?? "").toContain("chat");
  });
});
