/**
 * buildStreamErrorHandler stub-row shape · 2026-07-05 (audit P3 · c)
 *
 * Pre-P3 a mid-stream failure persisted the assistant stub with NO
 * streamingState (schema default "complete"), NO errorDetails, and a
 * "⚠️ Stream interrupted: …" annotation baked into `content` — which
 * hydration replayed to the model as genuine assistant speech, and the
 * error context hid inside the tokenUsage JSON where nothing reads it.
 *
 * These tests pin the honest shape: streamingState "errored",
 * structured errorDetails { code, message, provider, retryable },
 * and content = the bare partial text (or "" on a cold failure) with
 * no annotation. The MessageStatusBadge UI renders the error from
 * streamingState + errorDetails, so content stays clean.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const chatMessageCreateMock = vi.fn().mockResolvedValue({ id: "stub-1" });
const errorLogCreateMock = vi.fn().mockResolvedValue({ id: "err-1" });
vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { create: (...args: unknown[]) => chatMessageCreateMock(...args) },
    errorLog: { create: (...args: unknown[]) => errorLogCreateMock(...args) },
  },
}));

// The handler dynamically imports the provider module for failure
// marking — mock it so the import never touches real provider state.
const markProviderFailedMock = vi.fn();
vi.mock("@/lib/ai/provider", () => ({
  markProviderFailed: (...args: unknown[]) => markProviderFailedMock(...args),
  markGeminiQuotaExhausted: vi.fn(),
}));

import { buildStreamErrorHandler } from "@/lib/services/chat/stream-error-handler";

function makeDeps(partialText: string) {
  return {
    convId: "conv-1",
    conversationId: "conv-1",
    model: { modelId: "gemini-3.5-flash" },
    traceId: "trace-1",
    provider: "gemini" as const,
    modelId: "gemini-3.5-flash",
    startedAt: Date.now() - 1500,
    partial: { text: partialText },
    log: { info: vi.fn(), warn: vi.fn() },
    recordTrace: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  chatMessageCreateMock.mockResolvedValue({ id: "stub-1" });
  errorLogCreateMock.mockResolvedValue({ id: "err-1" });
});

describe("audit P3c · honest errored stub rows", () => {
  it("persists partial text with streamingState errored + structured errorDetails, no annotation", async () => {
    const partial = "Here is the start of a long answer about your Q3 revenue numbers";
    const onError = buildStreamErrorHandler(makeDeps(partial));

    await onError({ error: new Error("upstream connection reset") });

    expect(chatMessageCreateMock).toHaveBeenCalledTimes(1);
    const { data } = chatMessageCreateMock.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.streamingState).toBe("errored");
    expect(data.errorDetails).toMatchObject({
      code: "stream_interrupted",
      message: expect.stringContaining("upstream connection reset"),
      provider: "gemini",
      retryable: true,
    });
    // Content is the bare partial reply — exactly what the user saw.
    expect(data.content).toBe(partial);
    expect(String(data.content)).not.toContain("⚠️");
    expect(String(data.content)).not.toMatch(/stream interrupted/i);
  });

  it("cold failure (<20 chars partial) persists an EMPTY content stub, not an error sentence", async () => {
    const onError = buildStreamErrorHandler(makeDeps("Hi"));

    await onError({ error: new Error("HTTP 503 from provider") });

    expect(chatMessageCreateMock).toHaveBeenCalledTimes(1);
    const { data } = chatMessageCreateMock.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.streamingState).toBe("errored");
    expect(data.content).toBe("");
    expect(data.errorDetails).toMatchObject({
      code: "stream_interrupted",
      message: expect.stringContaining("HTTP 503"),
      provider: "gemini",
      retryable: true,
    });
  });

  it("still marks the failing provider and writes the trace + error log", async () => {
    const deps = makeDeps("A meaningful partial reply that is long enough.");
    const onError = buildStreamErrorHandler(deps);

    await onError({ error: new Error("boom") });

    expect(markProviderFailedMock).toHaveBeenCalledWith("gemini");
    expect(deps.recordTrace).toHaveBeenCalledTimes(1);
    expect(errorLogCreateMock).toHaveBeenCalledTimes(1);
  });

  it("skips the persist entirely when convId is missing", async () => {
    const deps = { ...makeDeps("Some partial text that is long enough."), convId: null };
    const onError = buildStreamErrorHandler(deps);

    await onError({ error: new Error("boom") });

    expect(chatMessageCreateMock).not.toHaveBeenCalled();
  });
});
