/**
 * Audit 08-F17: a Langfuse chat trace carried no statenour trace id, so a
 * receipt, an audit row or an agent_traces row could not be joined to it.
 * The per-attempt telemetry metadata now carries `statenourTraceId`.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/services/chat/stream-error-handler", () => ({ buildStreamErrorHandler: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({ buildOnFinish: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/ai/chat/repair-tool-call", () => ({ buildRepairToolCall: vi.fn(() => vi.fn()) }));

import { buildStreamConfigFactory } from "@/app/api/ai/chat/build-stream-config";

const build = (traceId: string) =>
  buildStreamConfigFactory({
    persistBase: { recordTrace: vi.fn() } as never,
    provider: "ollama" as never,
    modelId: "minimax-m3",
    finalSystemPrompt: "system",
    sanitizedModelMessages: [{ role: "user", content: "hi" }],
    prunedTools: {},
    mode: "standard" as never,
    maxOutputTokens: 1000,
    turnSignal: { kind: "conversational" } as never,
    webSearchIntent: false,
    actionIntent: null,
    actionPermission: undefined,
    privateMode: false,
    convId: "c1",
    conversationId: "conv-123",
    traceId,
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    partialRef: { text: "" },
    recordTrace: vi.fn() as never,
    resolveOnFinish: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
  } as never);

describe("Langfuse chat trace carries the statenour trace id", () => {
  it("the per-attempt telemetry metadata names this turn's traceId", () => {
    const cfg = build("t_join_1")({ modelId: "m", provider: "ollama" } as never) as unknown as {
      experimental_telemetry: { metadata: Record<string, unknown> };
    };
    expect(cfg.experimental_telemetry.metadata.statenourTraceId).toBe("t_join_1");
  });
});
