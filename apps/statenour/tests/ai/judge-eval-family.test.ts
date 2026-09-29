import { describe, expect, it } from "vitest";
import { modelFamily } from "@/lib/ai/judge-eval";

describe("Q-32 judge model-family separation", () => {
  it("classifies hosted models by model family before hosting provider", () => {
    expect(modelFamily("venice", "claude-sonnet-5")).toBe("anthropic");
    expect(modelFamily("ollama", "deepseek-v4-flash:0731")).toBe("deepseek");
    expect(modelFamily("venice", "glm-5.3-flash")).toBe("zhipu");
    expect(modelFamily("openai", "gpt-5.6")).toBe("openai");
    expect(modelFamily("google", "gemini-3-flash")).toBe("google");
  });

  it("uses only a provider that itself names a real model family as fallback", () => {
    expect(modelFamily("anthropic", "mystery-model")).toBe("anthropic");
    expect(modelFamily("openai", "mystery-model")).toBe("openai");
  });

  it("does not mistake a hosting layer for a model family", () => {
    expect(modelFamily("venice", "mystery-model")).toBe("unknown");
    expect(modelFamily("ollama", "mystery-model")).toBe("unknown");
    expect(modelFamily("custom-host", "mystery-model")).toBe("unknown");
  });

  it("returns unknown when neither lane is known", () => {
    expect(modelFamily(undefined, undefined)).toBe("unknown");
  });
});
