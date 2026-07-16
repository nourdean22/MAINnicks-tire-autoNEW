import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the AI SDK providers so they return identifiable model objects
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn((modelId) => ({ modelId }))),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => {
    const chat = vi.fn((modelId) => ({ modelId }));
    const fn = vi.fn((modelId) => ({ modelId }));
    (fn as any).chat = chat;
    return fn;
  }),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn((modelId) => ({ modelId }))),
}));

// Mock the AI SDK generateText to spy/control the execution
const generateTextMock = vi.fn();
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateText: (...args: any[]) => generateTextMock(...args),
  };
});

// Mock prisma to avoid hitting the actual database
vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiGeneration: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  generateTextMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Gemini Provider Configuration and Fallbacks", () => {
  it("defaults to gemini-3.5-flash as the flagship model", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    const { getProviderStatus } = await import("@/lib/ai/provider");
    const status = getProviderStatus();
    const gemini = status.providers.find((p) => p.name === "gemini");
    expect(gemini).toBeDefined();
    expect(gemini?.modelId).toBe("gemini-3.5-flash");
  });

  it("respects GEMINI_MODEL env override", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-custom-model-test");
    const { getProviderStatus } = await import("@/lib/ai/provider");
    const status = getProviderStatus();
    const gemini = status.providers.find((p) => p.name === "gemini");
    expect(gemini?.modelId).toBe("gemini-custom-model-test");
  });

  it("reports gemini as unavailable when GEMINI_API_KEY is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    const { getProviderStatus } = await import("@/lib/ai/provider");
    const status = getProviderStatus();
    const gemini = status.providers.find((p) => p.name === "gemini");
    expect(gemini?.available).toBe(false);
  });

  it("reports gemini as available when GEMINI_API_KEY is present", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    const { getProviderStatus } = await import("@/lib/ai/provider");
    const status = getProviderStatus();
    const gemini = status.providers.find((p) => p.name === "gemini");
    expect(gemini?.available).toBe(true);
  });

  it("trips the Gemini quota breaker on marking exhausted and clears it on clear", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    const {
      isGeminiQuotaExhausted,
      markGeminiQuotaExhausted,
      clearGeminiQuotaExhausted,
      getProviderStatus,
    } = await import("@/lib/ai/provider");

    expect(isGeminiQuotaExhausted()).toBe(false);

    markGeminiQuotaExhausted();
    expect(isGeminiQuotaExhausted()).toBe(true);

    const statusBefore = getProviderStatus();
    const geminiBefore = statusBefore.providers.find((p) => p.name === "gemini");
    expect(geminiBefore?.available).toBe(false);

    clearGeminiQuotaExhausted();
    expect(isGeminiQuotaExhausted()).toBe(false);
    const statusAfter = getProviderStatus();
    const geminiAfter = statusAfter.providers.find((p) => p.name === "gemini");
    expect(geminiAfter?.available).toBe(true);
  });

  // 2026-07-16 chat audit · the openai/anthropic breakers existed but
  // mark/clear were never exported — nothing could trip them, so the
  // 07-15 outage re-tried the dead paid lanes at ~29s/call. These tests
  // mirror the gemini breaker test above.
  it("trips the OpenAI quota breaker on marking exhausted and clears it on clear", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    const {
      isOpenAiQuotaExhausted,
      markOpenAiQuotaExhausted,
      clearOpenAiQuotaExhausted,
      getProviderStatus,
    } = await import("@/lib/ai/provider");

    expect(isOpenAiQuotaExhausted()).toBe(false);

    markOpenAiQuotaExhausted();
    expect(isOpenAiQuotaExhausted()).toBe(true);
    const statusBefore = getProviderStatus();
    expect(statusBefore.providers.find((p) => p.name === "openai")?.available).toBe(false);

    clearOpenAiQuotaExhausted();
    expect(isOpenAiQuotaExhausted()).toBe(false);
    const statusAfter = getProviderStatus();
    expect(statusAfter.providers.find((p) => p.name === "openai")?.available).toBe(true);
  });

  it("trips the Anthropic quota breaker on marking exhausted and clears it on clear", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");
    const {
      isAnthropicQuotaExhausted,
      markAnthropicQuotaExhausted,
      clearAnthropicQuotaExhausted,
      getProviderStatus,
    } = await import("@/lib/ai/provider");

    expect(isAnthropicQuotaExhausted()).toBe(false);

    markAnthropicQuotaExhausted();
    expect(isAnthropicQuotaExhausted()).toBe(true);
    const statusBefore = getProviderStatus();
    expect(statusBefore.providers.find((p) => p.name === "anthropic")?.available).toBe(false);

    clearAnthropicQuotaExhausted();
    expect(isAnthropicQuotaExhausted()).toBe(false);
    const statusAfter = getProviderStatus();
    expect(statusAfter.providers.find((p) => p.name === "anthropic")?.available).toBe(true);
  });

  it("markProviderQuotaExhausted trips the breaker only for quota-class errors", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    const { markProviderQuotaExhausted, isOpenAiQuotaExhausted, clearOpenAiQuotaExhausted } =
      await import("@/lib/ai/provider");

    // Non-quota failure → short rotation only, breaker stays closed.
    expect(markProviderQuotaExhausted("openai", "upstream 503 bad gateway")).toBe(false);
    expect(isOpenAiQuotaExhausted()).toBe(false);

    // Quota failure → breaker trips.
    expect(
      markProviderQuotaExhausted("openai", "429 insufficient_quota — you exceeded your current quota"),
    ).toBe(true);
    expect(isOpenAiQuotaExhausted()).toBe(true);
    clearOpenAiQuotaExhausted();

    // Providers without a breaker (openrouter) are a safe no-op.
    expect(markProviderQuotaExhausted("openrouter", "429 too many requests")).toBe(false);
  });

  it("getModel tags the returned model with its ground-truth provider (getTaggedModelProvider)", async () => {
    vi.stubEnv("OLLAMA_API_KEY", "test-ollama-key-is-sufficiently-long-for-validation");
    const { getModel, getTaggedModelProvider } = await import("@/lib/ai/provider");

    const model = getModel("reason");
    expect(getTaggedModelProvider(model)).toBe("ollama");
    // Untagged objects (foreign models) return null — inference fallback applies.
    expect(getTaggedModelProvider({ modelId: "whatever" })).toBeNull();
  });

  it("reorders provider chain when preferLargeContext is passed, placing ollama first, then gemini", async () => {
    vi.stubEnv("OLLAMA_API_KEY", "test-ollama-key-is-sufficiently-long-for-validation");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");

    const { getModel } = await import("@/lib/ai/provider");

    // Track the sequence of models attempted if we try to call getModel in a loop
    const { getActiveProviderInfo } = await import("@/lib/ai/provider");
    
    // We want to test getModel's logic directly. We can verify getModel returns the correct model.
    const model = getModel("reason", { preferLargeContext: true });
    // Since Ollama is first in the LargeContext sort chain, it should return Ollama's model ID
    // (2026-07-12 · default OLLAMA_MODEL is now the uncensored deepseek-v4-pro).
    expect((model as any).modelId).toBe("deepseek-v4-pro");
  });

  it("aiChat falls back in the correct order when budget is nearing limit", async () => {
    vi.stubEnv("OLLAMA_API_KEY", "test-ollama-key-is-sufficiently-long-for-validation");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");

    const { aiChat } = await import("@/lib/ai/provider");

    // Track the sequence of models attempted
    const attemptedModels: string[] = [];
    generateTextMock.mockImplementation(({ model }) => {
      attemptedModels.push(model.modelId);
      throw new Error("mock-failure");
    });

    const result = await aiChat([{ role: "user", content: "test" }], "reason", {
      budgetNearingLimit: true,
    });

    // Check that we returned the emergency sentinel response
    expect(result.provider).toBe("emergency");

    // Check the order of models called:
    // Prio: ollama (0 cost) -> gemini (1) -> openai (2). anthropic (3) is skipped because hasCheaper is true.
    expect(attemptedModels).toEqual([
      "deepseek-v4-pro",
      "gemini-3.5-flash",
      "gpt-4o",
    ]);
  });

  describe("Task Routing Matrix", () => {
    it("routes EVERY task to Ollama Cloud first (2026-07-12 ollama-first directive)", async () => {
      vi.stubEnv("OLLAMA_API_KEY", "test-ollama-key-is-sufficiently-long-for-validation");
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
      vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
      vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");

      const { getActiveProviderInfo } = await import("@/lib/ai/provider");
      // These previously routed to Gemini first; the ollama-first switch moves
      // them to Ollama Cloud (un-capped, least-restricted).
      expect(getActiveProviderInfo("fast").provider).toBe("ollama");
      expect(getActiveProviderInfo("summary").provider).toBe("ollama");
      expect(getActiveProviderInfo("classify").provider).toBe("ollama");
      expect(getActiveProviderInfo("extract").provider).toBe("ollama");
      expect(getActiveProviderInfo("vision").provider).toBe("ollama");
      expect(getActiveProviderInfo("embed").provider).toBe("ollama");
    });

    it("fast-lane tasks resolve OLLAMA_FAST_MODEL, chat lane resolves OLLAMA_MODEL", async () => {
      vi.stubEnv("OLLAMA_MODEL", "deepseek-v3.1:671b");
      vi.stubEnv("OLLAMA_FAST_MODEL", "glm-5.2");
      const { resolveProviderModel } = await import("@/lib/ai/provider");
      // High-frequency internal lanes → fast model
      expect(resolveProviderModel("ollama", "classify")).toBe("glm-5.2");
      expect(resolveProviderModel("ollama", "extract")).toBe("glm-5.2");
      expect(resolveProviderModel("ollama", "summary")).toBe("glm-5.2");
      expect(resolveProviderModel("ollama", "fast")).toBe("glm-5.2");
      // User-facing lanes → full uncensored model
      expect(resolveProviderModel("ollama", "reason")).toBe("deepseek-v3.1:671b");
      expect(resolveProviderModel("ollama", "deep")).toBe("deepseek-v3.1:671b");
    });

    it("routes reason, creative, sql, math to Ollama first", async () => {
      vi.stubEnv("OLLAMA_API_KEY", "test-ollama-key-is-sufficiently-long-for-validation");
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
      vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
      vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");

      const { getActiveProviderInfo } = await import("@/lib/ai/provider");
      expect(getActiveProviderInfo("reason").provider).toBe("ollama");
      expect(getActiveProviderInfo("creative").provider).toBe("ollama");
      expect(getActiveProviderInfo("sql").provider).toBe("ollama");
      expect(getActiveProviderInfo("math").provider).toBe("ollama");
    });

    it("routes deep to Ollama first, and falls back to Gemini then OpenAI if they are unavailable", async () => {
      vi.stubEnv("OLLAMA_API_KEY", "");
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
      vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
      vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");

      const { getActiveProviderInfo } = await import("@/lib/ai/provider");
      // Falls back to Gemini
      expect(getActiveProviderInfo("deep").provider).toBe("gemini");

      // Falls back to OpenAI if Gemini is also unavailable
      vi.stubEnv("GEMINI_API_KEY", "");
      const { getActiveProviderInfo: getActiveProviderInfo2 } = await import("@/lib/ai/provider");
      expect(getActiveProviderInfo2("deep").provider).toBe("openai");
    });

    it("routes code to Ollama first, falling back to Gemini, then OpenAI", async () => {
      vi.stubEnv("OLLAMA_API_KEY", "");
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
      vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
      vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");

      const { getActiveProviderInfo } = await import("@/lib/ai/provider");
      // Falls back to Gemini
      expect(getActiveProviderInfo("code").provider).toBe("gemini");

      // Falls back to OpenAI if Gemini is also unavailable
      vi.stubEnv("GEMINI_API_KEY", "");
      const { getActiveProviderInfo: getActiveProviderInfo2 } = await import("@/lib/ai/provider");
      expect(getActiveProviderInfo2("code").provider).toBe("openai");
    });

    it("correctly resolves gpt-oss to the ollama provider instead of openai", async () => {
      const { modelToProvider } = await import("@/lib/ai/provider-health");
      expect(modelToProvider("gpt-oss:120b")).toBe("ollama");
      expect(modelToProvider("gpt-4o")).toBe("openai");
    });

    it("respects forceProviderFirst parameter to prioritize anthropic for mutations", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

      const { getModel } = await import("@/lib/ai/provider");
      const model = getModel("reason", { forceProviderFirst: "anthropic" });
      expect((model as any).modelId).toContain("claude");
    });
  });

  describe("Ollama createOllamaModel fetch config", () => {
    it("configures custom fetch that adds reasoning options for reasoning models", async () => {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const { getModel } = await import("@/lib/ai/provider");

      vi.stubEnv("OLLAMA_API_KEY", "test-ollama-key-is-sufficiently-long-for-validation");
      vi.stubEnv("OLLAMA_MODEL", "gpt-oss:120b");

      // Trigger creation of Ollama model
      getModel("reason");

      // Inspect createOpenAI mock calls
      const lastCall = vi.mocked(createOpenAI).mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      const configObj = lastCall?.[0];
      expect(configObj?.fetch).toBeDefined();

      // Test the custom fetch function with a reasoning model request body
      const originalFetch = globalThis.fetch;
      const fetchSpy = vi.fn().mockResolvedValue(new Response("{}"));
      globalThis.fetch = fetchSpy;

      try {
        const bodyWithTools = JSON.stringify({
          max_tokens: 2048,
          tools: [{ name: "runPython" }],
        });

        await configObj.fetch("https://api.example.com", {
          body: bodyWithTools,
        });

        expect(fetchSpy).toHaveBeenCalled();
        const callArgs = fetchSpy.mock.calls[0];
        const parsedBody = JSON.parse(callArgs[1].body);
        expect(parsedBody.options.num_predict).toBe(2048);
        // Excludes reasoning because tools are present
        expect(parsedBody.reasoning?.exclude).toBe(true);
        expect(parsedBody.include_reasoning).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
