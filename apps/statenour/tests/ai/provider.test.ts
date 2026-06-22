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
    expect((model as any).modelId).toBe("glm-5.2");
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
      "glm-5.2",
      "gemini-3.5-flash",
      "gpt-4o-mini",
    ]);
  });

  describe("Task Routing Matrix", () => {
    it("routes fast, summary, classify, extract, vision, embed to Gemini first", async () => {
      vi.stubEnv("OLLAMA_API_KEY", "test-ollama-key-is-sufficiently-long-for-validation");
      vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
      vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
      vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");

      const { getActiveProviderInfo } = await import("@/lib/ai/provider");
      expect(getActiveProviderInfo("fast").provider).toBe("gemini");
      expect(getActiveProviderInfo("summary").provider).toBe("gemini");
      expect(getActiveProviderInfo("classify").provider).toBe("gemini");
      expect(getActiveProviderInfo("extract").provider).toBe("gemini");
      expect(getActiveProviderInfo("vision").provider).toBe("gemini");
      expect(getActiveProviderInfo("embed").provider).toBe("gemini");
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
  });
});
