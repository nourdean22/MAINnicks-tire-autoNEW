/**
 * v10 Track B.5 · Tests for same-turn streamText fallback.
 *
 * 2026-07-05 (audit P3) · rewritten for the streamText-based contract:
 *   · ToolLoopAgent removed — it silently dropped onError/onChunk/
 *     maxOutputTokens/toolChoice (ToolLoopAgentSettings accepts the
 *     last two but AgentStreamParameters has no callback slots for
 *     the first two — verified against ai@6.0.162 dist types).
 *   · streamText returns SYNCHRONOUSLY and never rejects on provider
 *     HTTP errors — those surface as stream `error` parts. The loop
 *     now probes the first chunk(s) of fullStream so a pre-first-token
 *     error part rotates to the next provider (same-turn failover).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the AI SDK — streamWithFallback now calls plain streamText.
const streamTextMock = vi.fn();
vi.mock("ai", () => ({
  stepCountIs: (n: number) => ({ __stepCountIs: n }),
  streamText: (config: unknown) => streamTextMock(config),
}));

// Mock error-log — the fallback loop logs loudly (logError → ErrorLog
// table) when provider inference fails; stub it so tests never touch
// prisma and can assert the loud path fired.
const logErrorMock = vi.fn();
vi.mock("@/lib/utils/error-log", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

// Mock provider — control which model getModel returns.
const getModelMock = vi.fn();
const markProviderFailedMock = vi.fn();
// Spread the REAL module so the real classifyModelId (used by inferProviderName)
// is available; only getModel + markProviderFailed are stubbed to drive the loop.
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  getModel: (...args: unknown[]) => getModelMock(...args),
  markProviderFailed: (...args: unknown[]) => markProviderFailedMock(...args),
}));

import { streamWithFallback, inferProviderName } from "@/lib/ai/stream-with-fallback";

/**
 * Builds a fake StreamTextResult. `parts` feed the fullStream the
 * first-chunk probe reads. Default: one text-delta so probes commit.
 */
function makeStreamResult(
  parts: Array<Record<string, unknown>> = [{ type: "text-delta", text: "ok" }],
  opts: { neverClose?: boolean } = {},
) {
  return {
    fullStream: new ReadableStream({
      start(controller) {
        for (const p of parts) controller.enqueue(p);
        if (!opts.neverClose) controller.close();
      },
    }),
    toUIMessageStreamResponse: () =>
      new Response("mock body", {
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      }),
    toolCalls: Promise.resolve([]),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  streamTextMock.mockImplementation(() => makeStreamResult());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("v10 B.5 · streamWithFallback", () => {
  it("returns the streamText result on first-attempt success", async () => {
    const fakeModel = { modelId: "gemini/gemini-3.5-flash" };
    getModelMock.mockReturnValueOnce(fakeModel);

    const out = await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) => ({ model, system: "test" }) as never,
    });

    const streamRes = out.result.toUIMessageStreamResponse();
    expect(streamRes.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(out.provider).toBe("gemini");
    expect(out.attempts.length).toBe(1);
    expect(out.attempts[0].errorClass).toBeNull();
    expect(markProviderFailedMock).not.toHaveBeenCalled();
  });

  it("retries with next provider on sync throw, succeeds on attempt 2", async () => {
    const geminiModel = { modelId: "gemini/gemini-3.5-flash" };
    const ollamaModel = { modelId: "ollama/qwen3-235b" };

    getModelMock
      .mockReturnValueOnce(geminiModel)
      .mockReturnValueOnce(ollamaModel);
    streamTextMock
      .mockImplementationOnce(() => {
        throw new Error("gemini 503");
      })
      .mockImplementationOnce(() => makeStreamResult());

    const out = await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) => ({ model, system: "test" }) as never,
    });

    const streamRes2 = out.result.toUIMessageStreamResponse();
    expect(streamRes2.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(out.provider).toBe("ollama");
    expect(out.attempts.length).toBe(2);
    expect(out.attempts[0].errorClass).toBe("stream_text_sync_throw");
    expect(out.attempts[0].provider).toBe("gemini");
    expect(out.attempts[1].errorClass).toBeNull();
    expect(markProviderFailedMock).toHaveBeenCalledWith("gemini");
  });

  it("throws when all attempts fail · trace attached to error", async () => {
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
      await streamWithFallback({
        taskType: "reason",
        buildConfig: (model: any) => ({ model, system: "test" }) as never,
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

  it("respects maxAttempts cap", async () => {
    getModelMock.mockReturnValue({ modelId: "gemini/m" });
    streamTextMock.mockImplementation(() => {
      throw new Error("transient");
    });

    let thrown: unknown;
    try {
      await streamWithFallback({
        taskType: "reason",
        maxAttempts: 2,
        buildConfig: (model: any) => ({ model, system: "test" }) as never,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    const wrapped = thrown as Error & { attempts?: unknown[] };
    expect(wrapped.attempts!.length).toBe(2);
  });

  it("getModel throwing 'no provider' breaks loop with no_provider_available", async () => {
    getModelMock.mockImplementation(() => {
      throw new Error("No AI provider available");
    });

    let thrown: unknown;
    try {
      await streamWithFallback({
        taskType: "reason",
        buildConfig: (model: any) => ({ model, system: "test" }) as never,
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
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("provider name inferred from modelId · gpt-4 → openai", async () => {
    getModelMock.mockReturnValueOnce({ modelId: "gpt-4o-2024-08-06" });

    const out = await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) => ({ model, system: "test" }) as never,
    });

    expect(out.provider).toBe("openai");
  });

  it("provider name inferred from modelId · claude-3-5 → anthropic", async () => {
    getModelMock.mockReturnValueOnce({ modelId: "claude-3-5-sonnet-20241022" });

    const out = await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) => ({ model, system: "test" }) as never,
    });

    expect(out.provider).toBe("anthropic");
  });

  it("buildConfig called fresh on each attempt with the chosen model", async () => {
    const m1 = { modelId: "gemini/m" };
    const m2 = { modelId: "ollama/m" };
    getModelMock.mockReturnValueOnce(m1).mockReturnValueOnce(m2);
    streamTextMock
      .mockImplementationOnce(() => {
        throw new Error("e");
      })
      .mockImplementationOnce(() => makeStreamResult());

    const buildConfig = vi.fn(
      (model: unknown) => ({ model, system: "test" }) as never,
    );
    await streamWithFallback({
      taskType: "reason",
      buildConfig,
    });

    expect(buildConfig).toHaveBeenCalledTimes(2);
    expect(buildConfig).toHaveBeenNthCalledWith(1, m1);
    expect(buildConfig).toHaveBeenNthCalledWith(2, m2);
  });
});

describe("audit P3 · config pass-through", () => {
  it("forwards maxOutputTokens, toolChoice, onChunk, onError and abortSignal to streamText", async () => {
    getModelMock.mockReturnValueOnce({ modelId: "gemini-3.5-flash" });
    const routeOnChunk = vi.fn();
    const routeOnError = vi.fn();
    const routeOnFinish = vi.fn();

    const out = await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) =>
        ({
          model,
          system: "test",
          maxOutputTokens: 1234,
          toolChoice: { type: "tool", toolName: "runPython" },
          onChunk: routeOnChunk,
          onError: routeOnError,
          onFinish: routeOnFinish,
          temperature: 0.4,
        }) as never,
    });

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const captured = streamTextMock.mock.calls[0][0] as Record<string, unknown>;
    expect(captured.maxOutputTokens).toBe(1234);
    expect(captured.toolChoice).toEqual({ type: "tool", toolName: "runPython" });
    expect(captured.temperature).toBe(0.4);
    expect(captured.onChunk).toBe(routeOnChunk);
    expect(captured.onFinish).toBe(routeOnFinish);
    expect(captured.abortSignal).toBeInstanceOf(AbortSignal);
    // onError may be wrapped by the first-chunk gate — but a committed
    // stream MUST delegate every event to the route's handler.
    expect(typeof captured.onError).toBe("function");
    const evt = { error: new Error("mid-stream 502") };
    (captured.onError as (e: unknown) => void)(evt);
    expect(routeOnError).toHaveBeenCalledWith(evt);
    expect(out.attempts[0].errorClass).toBeNull();
  });
});

describe("audit P3 · first-chunk probe failover", () => {
  it("rotates provider when an error part arrives before the first content token", async () => {
    getModelMock
      .mockReturnValueOnce({ modelId: "gemini-3.5-flash" })
      .mockReturnValueOnce({ modelId: "claude-3-5-sonnet" });
    streamTextMock
      .mockImplementationOnce(() =>
        makeStreamResult([
          { type: "start" },
          { type: "start-step" },
          { type: "error", error: new Error("upstream 503") },
        ]),
      )
      .mockImplementationOnce(() =>
        makeStreamResult([{ type: "start" }, { type: "text-delta", text: "hello" }]),
      );

    const out = await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) => ({ model, system: "test" }) as never,
    });

    expect(out.provider).toBe("anthropic");
    expect(out.attempts.length).toBe(2);
    expect(out.attempts[0].errorClass).toBe("first_chunk_error_part");
    expect(out.attempts[0].errorMessage).toContain("upstream 503");
    expect(out.attempts[1].errorClass).toBeNull();
    expect(markProviderFailedMock).toHaveBeenCalledWith("gemini");
    expect(markProviderFailedMock).not.toHaveBeenCalledWith("anthropic");
  });

  it("suppresses the route onError for a probe-failed attempt (rotation owns it)", async () => {
    const routeOnError = vi.fn();
    getModelMock
      .mockReturnValueOnce({ modelId: "gemini-3.5-flash" })
      .mockReturnValueOnce({ modelId: "claude-3-5-sonnet" });

    const capturedOnErrors: Array<(e: { error: unknown }) => void> = [];
    streamTextMock
      .mockImplementationOnce((config: any) => {
        capturedOnErrors.push(config.onError);
        // Simulate the SDK firing onError as the error part flows.
        queueMicrotask(() => config.onError({ error: new Error("upstream 503") }));
        return makeStreamResult([{ type: "error", error: new Error("upstream 503") }]);
      })
      .mockImplementationOnce((config: any) => {
        capturedOnErrors.push(config.onError);
        return makeStreamResult();
      });

    const out = await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) => ({ model, onError: routeOnError }) as never,
    });

    expect(out.attempts.length).toBe(2);
    // The failed attempt's error was handled by rotation, NOT persisted
    // as a stream-interrupted stub via the route handler.
    expect(routeOnError).not.toHaveBeenCalled();
    // A late error on the ALREADY-FAILED attempt stays suppressed…
    capturedOnErrors[0]({ error: new Error("late abort noise") });
    expect(routeOnError).not.toHaveBeenCalled();
    // …while the committed attempt forwards mid-stream errors.
    const midStream = { error: new Error("mid-stream drop") };
    capturedOnErrors[1](midStream);
    expect(routeOnError).toHaveBeenCalledTimes(1);
    expect(routeOnError).toHaveBeenCalledWith(midStream);
  });

  it("counts probe failures against maxAttempts and throws when exhausted", async () => {
    getModelMock.mockReturnValue({ modelId: "gemini-3.5-flash" });
    streamTextMock.mockImplementation(() =>
      makeStreamResult([{ type: "error", error: new Error("hard down") }]),
    );

    let thrown: unknown;
    try {
      await streamWithFallback({
        taskType: "reason",
        maxAttempts: 2,
        buildConfig: (model: any) => ({ model }) as never,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    const wrapped = thrown as Error & { attempts?: Array<{ errorClass: string | null }> };
    expect(wrapped.attempts!.length).toBe(2);
    expect(wrapped.attempts!.every((a) => a.errorClass === "first_chunk_error_part")).toBe(true);
  });

  it("commits the attempt when the probe times out (slow provider ≠ dead provider)", async () => {
    vi.useFakeTimers();
    getModelMock.mockReturnValueOnce({ modelId: "gemini-3.5-flash" });
    // Stream that produces nothing within the probe window.
    streamTextMock.mockImplementationOnce(() => makeStreamResult([], { neverClose: true }));

    const promise = streamWithFallback({
      taskType: "reason",
      firstChunkTimeoutMs: 10_000,
      buildConfig: (model: any) => ({ model }) as never,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const out = await promise;

    expect(out.attempts.length).toBe(1);
    expect(out.attempts[0].errorClass).toBeNull();
    expect(markProviderFailedMock).not.toHaveBeenCalled();
  });

  it("leaves no stray timers after a committed attempt (latent 3.5s ollama timer removed)", async () => {
    vi.useFakeTimers();
    getModelMock.mockReturnValueOnce({ modelId: "gpt-oss:120b" });

    await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) => ({ model }) as never,
    });

    // Pre-P3 the ollama "thinking budget" setTimeout was never cleared
    // on success; the probe timer must be cleared on settle.
    expect(vi.getTimerCount()).toBe(0);
  });
});

/**
 * 2026-07-16 chat audit · (1) openai/anthropic quota breakers were
 * UNWIRED — they existed in provider.ts but mark was never exported and
 * no failure path called them, so during the 07-15 provider outage every
 * chat call re-tried the dead paid lanes and burned the full per-attempt
 * timeout (~29s/call). (2) When inferProviderName returned null the
 * failure-marking silently no-opped and the dead lane was re-picked on
 * every retry. These tests exercise the REAL breaker state (the provider
 * mock spreads the real module; only getModel/markProviderFailed are
 * stubbed), so `isOpenAiQuotaExhausted` etc. observe genuine wiring.
 */
describe("2026-07-16 audit · quota breakers wired into the stream failure path", () => {
  afterEach(async () => {
    const provider = await import("@/lib/ai/provider");
    (provider as { clearOpenAiQuotaExhausted?: () => void }).clearOpenAiQuotaExhausted?.();
    (provider as { clearAnthropicQuotaExhausted?: () => void }).clearAnthropicQuotaExhausted?.();
  });

  it("an openai-lane quota error part trips the openai breaker (isOpenAiQuotaExhausted → true)", async () => {
    const { isOpenAiQuotaExhausted, isAnthropicQuotaExhausted } = await import("@/lib/ai/provider");
    expect(isOpenAiQuotaExhausted()).toBe(false);

    getModelMock
      .mockReturnValueOnce({ modelId: "gpt-4o" })
      .mockReturnValueOnce({ modelId: "claude-3-5-sonnet" });
    streamTextMock
      .mockImplementationOnce(() =>
        makeStreamResult([
          { type: "error", error: new Error("429 insufficient_quota — you exceeded your current quota") },
        ]),
      )
      .mockImplementationOnce(() => makeStreamResult());

    const out = await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) => ({ model, system: "test" }) as never,
    });

    expect(out.provider).toBe("anthropic");
    expect(markProviderFailedMock).toHaveBeenCalledWith("openai");
    // THE fix: the quota error tripped the openai circuit breaker…
    expect(isOpenAiQuotaExhausted()).toBe(true);
    // …and only openai's — the healthy rotation target is untouched.
    expect(isAnthropicQuotaExhausted()).toBe(false);
  });

  it("an anthropic-lane billing error trips the anthropic breaker", async () => {
    const { isAnthropicQuotaExhausted } = await import("@/lib/ai/provider");
    expect(isAnthropicQuotaExhausted()).toBe(false);

    getModelMock
      .mockReturnValueOnce({ modelId: "claude-3-5-sonnet" })
      .mockReturnValueOnce({ modelId: "gemini-3.5-flash" });
    streamTextMock
      .mockImplementationOnce(() =>
        makeStreamResult([
          { type: "error", error: new Error("Your credit balance is too low to access the Anthropic API") },
        ]),
      )
      .mockImplementationOnce(() => makeStreamResult());

    await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) => ({ model, system: "test" }) as never,
    });

    expect(markProviderFailedMock).toHaveBeenCalledWith("anthropic");
    expect(isAnthropicQuotaExhausted()).toBe(true);
  });

  it("a NON-quota failure marks the 60s rotation only — the long breaker stays closed", async () => {
    const { isOpenAiQuotaExhausted } = await import("@/lib/ai/provider");

    getModelMock
      .mockReturnValueOnce({ modelId: "gpt-4o" })
      .mockReturnValueOnce({ modelId: "gemini-3.5-flash" });
    streamTextMock
      .mockImplementationOnce(() =>
        makeStreamResult([{ type: "error", error: new Error("upstream 503 bad gateway") }]),
      )
      .mockImplementationOnce(() => makeStreamResult());

    await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) => ({ model, system: "test" }) as never,
    });

    expect(markProviderFailedMock).toHaveBeenCalledWith("openai");
    expect(isOpenAiQuotaExhausted()).toBe(false);
  });
});

describe("2026-07-16 audit · unknown-modelId marking is no longer a silent no-op", () => {
  it("logs loudly (logError with the modelId) when the provider can't be inferred on failure", async () => {
    getModelMock.mockReturnValue({ modelId: "mystery-model-9000" });
    streamTextMock.mockImplementation(() => {
      throw new Error("provider down");
    });

    let thrown: unknown;
    try {
      await streamWithFallback({
        taskType: "reason",
        maxAttempts: 1,
        buildConfig: (model: any) => ({ model, system: "test" }) as never,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    // Marking couldn't run (no lane to mark) — but it must be LOUD now.
    expect(markProviderFailedMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const [source, err, ctx] = logErrorMock.mock.calls[0] as [string, Error, Record<string, unknown>];
    expect(source).toBe("ai.stream-with-fallback");
    expect(err.message).toContain("mystery-model-9000");
    expect(ctx).toMatchObject({ modelId: "mystery-model-9000" });
  });

  it("prefers the ground-truth provider tag getModel stamps on the model over string inference", async () => {
    // getModel() tags every model it builds with the provider entry that
    // created it — inference no longer guesses when the tag is present,
    // even for a modelId classifyModelId can't place.
    const taggedModel: Record<PropertyKey, unknown> = { modelId: "mystery-model-9000" };
    Object.defineProperty(taggedModel, Symbol.for("nour.ai.providerName"), {
      value: "openai",
      enumerable: false,
    });
    expect(inferProviderName(taggedModel)).toBe("openai");

    getModelMock
      .mockReturnValueOnce(taggedModel)
      .mockReturnValueOnce({ modelId: "gemini-3.5-flash" });
    streamTextMock
      .mockImplementationOnce(() => {
        throw new Error("provider down");
      })
      .mockImplementationOnce(() => makeStreamResult());

    const out = await streamWithFallback({
      taskType: "reason",
      buildConfig: (model: any) => ({ model, system: "test" }) as never,
    });

    // The failing lane was marked via the tag — no silent skip, no guess.
    expect(out.attempts[0].provider).toBe("openai");
    expect(markProviderFailedMock).toHaveBeenCalledWith("openai");
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});

describe("audit P3 · inferProviderName ollama colon-tag ids", () => {
  it("classifies bare ollama name:tag ids as ollama (not openai)", () => {
    // The deployed OLLAMA default model. Pre-P3 startsWith("gpt-")
    // classified it as openai → failure-marking banned the WRONG lane.
    expect(inferProviderName({ modelId: "gpt-oss:120b" })).toBe("ollama");
    expect(inferProviderName({ modelId: "llama3.1:8b" })).toBe("ollama");
    expect(inferProviderName({ modelId: "qwen3:14b" })).toBe("ollama");
  });

  it("keeps non-colon native ids on their own providers", () => {
    expect(inferProviderName({ modelId: "gpt-4o" })).toBe("openai");
    expect(inferProviderName({ modelId: "claude-3-5-sonnet-latest" })).toBe("anthropic");
    expect(inferProviderName({ modelId: "gemini-3.5-flash" })).toBe("gemini");
    expect(inferProviderName({ modelId: "google/gemini-2.5-flash" })).toBe("openrouter");
  });
});
