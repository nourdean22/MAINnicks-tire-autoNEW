/**
 * v10 Track B.5 · Tests for same-turn streamText fallback.
 *
 * Verifies the contract that closes the pre-first-token gap.
 * v9.1.27 already shipped cross-request rotation. v10 B.5 adds
 * same-turn rotation when streamText throws synchronously.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AI SDK streamText to control sync-throw behavior.
const streamTextMock = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
}));

// Mock provider — control which model getModel returns.
const getModelMock = vi.fn();
const markProviderFailedMock = vi.fn();
vi.mock("@/lib/ai/provider", () => ({
  getModel: (...args: unknown[]) => getModelMock(...args),
  markProviderFailed: (...args: unknown[]) => markProviderFailedMock(...args),
}));

import { streamWithFallback } from "@/lib/ai/stream-with-fallback";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("v10 B.5 · streamWithFallback", () => {
  it("returns the streamText result on first-attempt success", () => {
    const fakeModel = { modelId: "gemini/gemini-2.5-flash" };
    const fakeResult = { __mockResult: true };
    getModelMock.mockReturnValueOnce(fakeModel);
    streamTextMock.mockReturnValueOnce(fakeResult);

    const out = streamWithFallback({
      taskType: "reason",
      buildConfig: (model) => ({ model, system: "test" }) as never,
    });

    expect(out.result).toBe(fakeResult);
    expect(out.provider).toBe("gemini");
    expect(out.attempts.length).toBe(1);
    expect(out.attempts[0].errorClass).toBeNull();
    expect(markProviderFailedMock).not.toHaveBeenCalled();
  });

  it("retries with next provider on sync throw, succeeds on attempt 2", () => {
    const geminiModel = { modelId: "gemini/gemini-2.5-flash" };
    const ollamaModel = { modelId: "ollama/qwen3-235b" };
    const fakeResult = { __mockResult: true };

    getModelMock
      .mockReturnValueOnce(geminiModel)
      .mockReturnValueOnce(ollamaModel);
    streamTextMock
      .mockImplementationOnce(() => {
        throw new Error("gemini 503");
      })
      .mockReturnValueOnce(fakeResult);

    const out = streamWithFallback({
      taskType: "reason",
      buildConfig: (model) => ({ model, system: "test" }) as never,
    });

    expect(out.result).toBe(fakeResult);
    expect(out.provider).toBe("ollama");
    expect(out.attempts.length).toBe(2);
    expect(out.attempts[0].errorClass).toBe("stream_text_sync_throw");
    expect(out.attempts[0].provider).toBe("gemini");
    expect(out.attempts[1].errorClass).toBeNull();
    // Provider that failed got marked.
    expect(markProviderFailedMock).toHaveBeenCalledWith("gemini");
  });

  it("throws when all attempts fail · trace attached to error", () => {
    const geminiModel = { modelId: "gemini/m" };
    const ollamaModel = { modelId: "ollama/m" };
    const openaiModel = { modelId: "gpt-4o" };
    const anthropicModel = { modelId: "claude-3-5-sonnet" };

    getModelMock
      .mockReturnValueOnce(geminiModel)
      .mockReturnValueOnce(ollamaModel)
      .mockReturnValueOnce(openaiModel)
      .mockReturnValueOnce(anthropicModel);
    streamTextMock.mockImplementation(() => {
      throw new Error("provider down");
    });

    let thrown: unknown;
    try {
      streamWithFallback({
        taskType: "reason",
        buildConfig: (model) => ({ model, system: "test" }) as never,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    const wrapped = thrown as Error & {
      attempts?: Array<{ provider: string | null }>;
    };
    expect(wrapped.message).toContain("all 4 provider attempts failed");
    expect(wrapped.attempts).toBeDefined();
    expect(wrapped.attempts!.length).toBe(4);
    expect(markProviderFailedMock).toHaveBeenCalledTimes(4);
  });

  it("respects maxAttempts cap", () => {
    getModelMock.mockReturnValue({ modelId: "gemini/m" });
    streamTextMock.mockImplementation(() => {
      throw new Error("transient");
    });

    let thrown: unknown;
    try {
      streamWithFallback({
        taskType: "reason",
        maxAttempts: 2,
        buildConfig: (model) => ({ model, system: "test" }) as never,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    const wrapped = thrown as Error & { attempts?: unknown[] };
    expect(wrapped.attempts!.length).toBe(2);
  });

  it("getModel throwing 'no provider' breaks loop with no_provider_available", () => {
    getModelMock.mockImplementation(() => {
      throw new Error("No AI provider available");
    });

    let thrown: unknown;
    try {
      streamWithFallback({
        taskType: "reason",
        buildConfig: (model) => ({ model, system: "test" }) as never,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    const wrapped = thrown as Error & {
      attempts?: Array<{ errorClass: string | null }>;
    };
    expect(wrapped.attempts!.length).toBe(1);
    expect(wrapped.attempts![0].errorClass).toBe("no_provider_available");
    // streamText was never called since getModel never returned.
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("provider name inferred from modelId · gpt-4 → openai", () => {
    const openaiModel = { modelId: "gpt-4o-2024-08-06" };
    const fakeResult = { __mockResult: true };
    getModelMock.mockReturnValueOnce(openaiModel);
    streamTextMock.mockReturnValueOnce(fakeResult);

    const out = streamWithFallback({
      taskType: "reason",
      buildConfig: (model) => ({ model, system: "test" }) as never,
    });

    expect(out.provider).toBe("openai");
  });

  it("provider name inferred from modelId · claude-3-5 → anthropic", () => {
    const claudeModel = { modelId: "claude-3-5-sonnet-20241022" };
    const fakeResult = { __mockResult: true };
    getModelMock.mockReturnValueOnce(claudeModel);
    streamTextMock.mockReturnValueOnce(fakeResult);

    const out = streamWithFallback({
      taskType: "reason",
      buildConfig: (model) => ({ model, system: "test" }) as never,
    });

    expect(out.provider).toBe("anthropic");
  });

  it("buildConfig called fresh on each attempt with the chosen model", () => {
    const m1 = { modelId: "gemini/m" };
    const m2 = { modelId: "ollama/m" };
    getModelMock.mockReturnValueOnce(m1).mockReturnValueOnce(m2);
    streamTextMock
      .mockImplementationOnce(() => {
        throw new Error("e");
      })
      .mockReturnValueOnce({} as never);

    const buildConfig = vi.fn(
      (model: unknown) => ({ model, system: "test" }) as never,
    );
    streamWithFallback({
      taskType: "reason",
      buildConfig,
    });

    expect(buildConfig).toHaveBeenCalledTimes(2);
    expect(buildConfig).toHaveBeenNthCalledWith(1, m1);
    expect(buildConfig).toHaveBeenNthCalledWith(2, m2);
  });
});
