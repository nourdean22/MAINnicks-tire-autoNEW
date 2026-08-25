/**
 * 2026-08-25 · Langfuse telemetry block in the per-attempt stream config.
 *
 * Two behaviors pinned, both load-bearing:
 *   1. The config ships `experimental_telemetry` with the nick-chat
 *      functionId and per-attempt metadata (mode, modelId, provider,
 *      sessionId) — delete the block and this goes red (the
 *      braintrust-wrap orphan shape, made impossible to repeat quietly).
 *   2. PRIVACY: a private-mode turn builds with isEnabled false even
 *      while tracing is active — spans carry prompt + completion
 *      content, and private turns never leave the process.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/observability/langfuse", () => ({
  // Real gating logic is pinned in tests/lib/observability/langfuse.test.ts;
  // here the mock stands in for "processor started" so the private-mode
  // parameter is the only variable.
  isLangfuseTelemetryEnabled: (privateMode?: boolean) => !privateMode,
}));

vi.mock("@/lib/services/chat/stream-error-handler", () => ({
  buildStreamErrorHandler: vi.fn(() => vi.fn()),
}));
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({
  buildOnFinish: vi.fn(() => vi.fn()),
}));
vi.mock("@/lib/ai/chat/repair-tool-call", () => ({
  buildRepairToolCall: vi.fn(() => vi.fn()),
}));

import { buildStreamConfigFactory } from "@/app/api/ai/chat/build-stream-config";

function makeFactory(overrides: Record<string, unknown> = {}) {
  return buildStreamConfigFactory({
    persistBase: { recordTrace: vi.fn() } as never,
    provider: "ollama" as never,
    modelId: "minimax-m3",
    finalSystemPrompt: "system",
    sanitizedModelMessages: [{ role: "user", content: "hi" }],
    prunedTools: {},
    mode: "standard" as never,
    maxOutputTokens: 1000,
    turnSignal: { kind: "conversational" } as never,
    pythonExecuteIntent: false,
    webSearchIntent: false,
    actionIntent: null,
    actionPermission: undefined,
    privateMode: false,
    convId: "c1",
    conversationId: "conv-123",
    traceId: "t1",
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    partialRef: { text: "" },
    recordTrace: vi.fn() as never,
    resolveOnFinish: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    ...overrides,
  } as never);
}

describe("build-stream-config experimental_telemetry", () => {
  it("ships the telemetry block with functionId + per-attempt metadata", () => {
    const build = makeFactory();
    const cfg = build({ modelId: "fallback-model", provider: "ollama" } as never) as never as {
      experimental_telemetry: {
        isEnabled: boolean;
        functionId: string;
        metadata: Record<string, unknown>;
      };
    };
    expect(cfg.experimental_telemetry).toBeDefined();
    expect(cfg.experimental_telemetry.isEnabled).toBe(true);
    expect(cfg.experimental_telemetry.functionId).toBe("nick-chat");
    expect(cfg.experimental_telemetry.metadata.mode).toBe("standard");
    expect(cfg.experimental_telemetry.metadata.modelId).toBe("fallback-model");
    expect(cfg.experimental_telemetry.metadata.sessionId).toBe("conv-123");
  });

  it("PRIVACY: a private-mode turn builds with telemetry disabled", () => {
    const build = makeFactory({ privateMode: true });
    const cfg = build({ modelId: "m" } as never) as never as {
      experimental_telemetry: { isEnabled: boolean };
    };
    expect(cfg.experimental_telemetry.isEnabled).toBe(false);
  });

  it("omits sessionId when the turn has no conversationId yet", () => {
    const build = makeFactory({ conversationId: undefined });
    const cfg = build({ modelId: "m" } as never) as never as {
      experimental_telemetry: { metadata: Record<string, unknown> };
    };
    expect("sessionId" in cfg.experimental_telemetry.metadata).toBe(false);
  });
});
