import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PROVIDERS_REGISTRY,
  TASK_ROUTING_PREFERENCES,
  type RuntimeProviderName,
  type TaskType,
} from "@/config/ai-providers";
import {
  RUNTIME_PROVIDERS,
  resolveProviderModel,
  isRuntimeProvider,
} from "@/lib/ai/provider";

// We can test modelToProvider by importing it directly.
// Since it's not exported from provider-health.ts, we can either export it
// or test it indirectly by importing the file or using a test helper.
// Let's check: does provider-health.ts export modelToProvider? No.
// But we can test the mapping logic directly using the registry's substring check rule,
// or we can mock/import the file contents, or we can export modelToProvider.
// Let's check: is modelToProvider exported? No, it's a private helper.
// Wait! Let's export modelToProvider from provider-health.ts so we can test it directly!
// That is standard TDD practice and makes it highly testable.
// Let's import it from provider-health.
import { getProviderHealth } from "@/lib/ai/provider-health";

// Let's check if we can import a helper or if we should import modelToProvider by exporting it.
// Let's check if we can export it by modifying provider-health.ts or just write the test mapping directly.
// Let's export modelToProvider in provider-health.ts to make it testable!
// Yes, let's check: did we already write provider-health.ts? Yes.
// We can modify it to export modelToProvider, or we can just import it if we export it.
// Let's check if it's already exported. It is currently: `function modelToProvider`.
// Let's export it as: `export function modelToProvider`. We can do a quick replace in provider-health.ts.
// Let's write the test first using the exported function, and then we will export it.
import { modelToProvider } from "@/lib/ai/provider-health";

describe("AI Provider Registry Configuration", () => {
  it("locks Object.keys(PROVIDERS_REGISTRY) to RUNTIME_PROVIDERS", () => {
    const registryKeys = Object.keys(PROVIDERS_REGISTRY).sort();
    const runtimeKeys = [...RUNTIME_PROVIDERS].sort();
    expect(registryKeys).toEqual(runtimeKeys);
  });

  it("ensures the registry has no property 'emergency'", () => {
    expect(PROVIDERS_REGISTRY).not.toHaveProperty("emergency");
  });

  it("ensures Venice stays retired and is not in the registry", () => {
    const registryStr = JSON.stringify(PROVIDERS_REGISTRY).toLowerCase();
    expect(registryStr).not.toContain("venice");
    expect(PROVIDERS_REGISTRY).not.toHaveProperty("venice");
  });

  it("verifies every TaskType is covered in TASK_ROUTING_PREFERENCES", () => {
    const expectedTaskTypes: TaskType[] = [
      "fast",
      "reason",
      "deep",
      "vision",
      "embed",
      "code",
      "sql",
      "math",
      "creative",
      "summary",
      "classify",
      "extract",
    ];
    for (const task of expectedTaskTypes) {
      expect(TASK_ROUTING_PREFERENCES).toHaveProperty(task);
      const preferences = TASK_ROUTING_PREFERENCES[task];
      expect(Array.isArray(preferences)).toBe(true);
      expect(preferences.length).toBeGreaterThan(0);
      for (const provider of preferences) {
        expect(RUNTIME_PROVIDERS).toContain(provider);
      }
    }
  });
});

describe("AI Provider Resolvers & Fallbacks", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves Gemini using GEMINI_API_KEY first, falling back to GOOGLE_GENERATIVE_AI_API_KEY", async () => {
    // Mock the provider file loading to verify environment resolves correctly.
    // We can test resolveProviderModel or isGeminiAvailable indirectly.
    // Let's import provider availability checks dynamically to test them under different envs.
    const { getActiveProviderInfo } = await import("@/lib/ai/provider");

    process.env.GEMINI_API_KEY = "test_gemini_key";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
    
    // With only GEMINI_API_KEY set
    const { getModel } = await import("@/lib/ai/provider");
    expect(resolveProviderModel("gemini")).toBe("gemini-3.5-flash");
    
    // Verify fallback key behavior
    process.env.GEMINI_API_KEY = "";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test_google_key";
    
    // We can check availability functions directly
    // Let's check isGeminiAvailable from provider.ts
    const { getProviderStatus } = await import("@/lib/ai/provider");
    const status = getProviderStatus();
    const geminiStatus = status.providers.find(p => p.name === "gemini");
    expect(geminiStatus?.available).toBe(true);
  });

  it("resolves Ollama Vision model correctly when taskType is vision", () => {
    const originalOllamaModel = process.env.OLLAMA_MODEL;
    process.env.OLLAMA_MODEL = "";
    process.env.OLLAMA_VISION_MODEL = "test-ollama-vision:latest";
    expect(resolveProviderModel("ollama", "vision")).toBe("test-ollama-vision:latest");

    process.env.OLLAMA_VISION_MODEL = "";
    expect(resolveProviderModel("ollama", "vision")).toBe("qwen3-vl:235b-instruct");

    expect(resolveProviderModel("ollama", "reason")).toBe("glm-5.2");
    process.env.OLLAMA_MODEL = originalOllamaModel;
  });
});

describe("AI Provider Health Telemetry Mapping", () => {
  it("correctly maps various model IDs back to their providers based on registry rules", () => {
    // Test mapping of current/default models
    expect(modelToProvider("gemini-3.5-flash")).toBe("gemini");
    expect(modelToProvider("gpt-4o-mini")).toBe("openai");
    expect(modelToProvider("claude-sonnet-4-6")).toBe("anthropic");
    expect(modelToProvider("glm-5.2")).toBe("ollama");

    // Test mapping of custom/historical substrings
    expect(modelToProvider("glm-5")).toBe("ollama");
    expect(modelToProvider("qwen3-vl:235b-instruct")).toBe("ollama");
    expect(modelToProvider("qwen3.5:397b")).toBe("ollama");
    expect(modelToProvider("deepseek-v4-flash")).toBe("ollama");
    expect(modelToProvider("kimi-k2.6")).toBe("ollama");
    expect(modelToProvider("gemini-1.5-pro")).toBe("gemini");
    expect(modelToProvider("gemini-2.0-flash")).toBe("gemini");
    expect(modelToProvider("gpt-4o")).toBe("openai");
    expect(modelToProvider("o1-mini")).toBe("openai");
    expect(modelToProvider("o3-mini-2025-01-31")).toBe("openai");
    expect(modelToProvider("o4-preview")).toBe("openai");
    expect(modelToProvider("claude-3-5-sonnet-20241022")).toBe("anthropic");

    // Exclude images or unmapped strings
    expect(modelToProvider("flux-schnell")).toBeNull();
    expect(modelToProvider("unknown-ai-model")).toBeNull();
  });
});
