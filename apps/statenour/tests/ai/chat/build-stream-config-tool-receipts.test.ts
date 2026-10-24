/**
 * The consumer end of the errored-turn receipts: the chunks streamText hands
 * onChunk must reach the SAME accumulator the stream-error handler reads.
 * The unit tests prove the accumulator and the handler separately; only this
 * one fails if onChunk stops feeding it or the handler is built without it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/services/chat/stream-error-handler", () => ({ buildStreamErrorHandler: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({ buildOnFinish: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/ai/chat/repair-tool-call", () => ({ buildRepairToolCall: vi.fn(() => vi.fn()) }));

import { buildStreamConfigFactory } from "@/app/api/ai/chat/build-stream-config";
import { buildStreamErrorHandler } from "@/lib/services/chat/stream-error-handler";
import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";
import { createInFlightToolCalls, type ToolReceiptsSnapshot } from "@/lib/services/chat/in-flight-tool-calls";

const factory = (extra: Record<string, unknown> = {}) =>
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
    traceId: "t1",
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    partialRef: { text: "" },
    recordTrace: vi.fn() as never,
    resolveOnFinish: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    ...extra,
  } as never);

type Attempt = { onChunk: (event: unknown) => void };
type HandlerDeps = { toolReceipts?: () => ToolReceiptsSnapshot; afterTerminal?: (cb: () => void) => void; traceId?: string };
const handlerDeps = (): HandlerDeps => vi.mocked(buildStreamErrorHandler).mock.calls.at(-1)![0] as unknown as HandlerDeps;
const attemptOf = (build: ReturnType<typeof factory>): Attempt =>
  build({ modelId: "m", provider: "ollama" } as never) as unknown as Attempt;

beforeEach(() => vi.mocked(buildStreamErrorHandler).mockClear());

describe("onChunk feeds the accumulator the error handler reads", () => {
  it("a tool-call chunk is visible to the handler as an attempted write", () => {
    const attempt = attemptOf(factory());

    attempt.onChunk({ chunk: { type: "tool-call", toolCallId: "c1", toolName: "createTask", input: { title: "x" } } });

    const snapshot = handlerDeps().toolReceipts?.();
    expect(snapshot).toMatchObject({ trustworthy: true, receipts: [{ toolName: "createTask", sideEffecting: true }] });
  });

  it("a turn with text only reads as a trustworthy zero", () => {
    const attempt = attemptOf(factory());

    attempt.onChunk({ chunk: { type: "text-delta", id: "t1", text: "Hello" } });

    expect(handlerDeps().toolReceipts?.()).toEqual({ trustworthy: true, terminal: false, receipts: [] });
  });

  it("an accumulator handed in by the route is the one onChunk feeds and the handler reads", () => {
    const acc = createInFlightToolCalls();
    const attempt = attemptOf(factory({ toolCalls: acc }));

    attempt.onChunk({ chunk: { type: "tool-call", toolCallId: "c1", toolName: "createTask", input: {} } });

    expect(acc.snapshot()).toMatchObject({ trustworthy: true, receipts: [{ toolName: "createTask" }] });
    expect(handlerDeps().toolReceipts?.()).toEqual(acc.snapshot());
  });

  it("the handler's afterTerminal registers on that accumulator, so the route's terminate() settles the errored row", async () => {
    const acc = createInFlightToolCalls();
    attemptOf(factory({ toolCalls: acc }));
    const settle = vi.fn();

    handlerDeps().afterTerminal?.(settle);
    expect(settle).not.toHaveBeenCalled();
    await acc.terminate();

    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("the accumulator belongs to the turn: a tool seen on attempt 1 is still seen after a rotation to attempt 2", () => {
    const build = factory();
    attemptOf(build).onChunk({ chunk: { type: "tool-call", toolCallId: "c1", toolName: "createTask", input: {} } });
    attemptOf(build);

    expect(handlerDeps().toolReceipts?.()).toMatchObject({ trustworthy: true, receipts: [{ toolName: "createTask" }] });
  });

  it("two fallback attempts feed ONE record, and each attempt's own handler reads it", () => {
    // A same-turn fallback rotates models: attempt 1 may have started a write before it
    // failed, attempt 2 starts another. Both belong to the one reply the user sees, so the
    // errored row must carry both, whichever attempt's handler ends up writing it.
    const acc = createInFlightToolCalls();
    const build = factory({ toolCalls: acc });
    const first = attemptOf(build);
    const firstHandler = handlerDeps();
    const second = attemptOf(build);
    const secondHandler = handlerDeps();
    expect(secondHandler, "each attempt builds its own error handler").not.toBe(firstHandler);

    first.onChunk({ chunk: { type: "tool-call", toolCallId: "c1", toolName: "createTask", input: { title: "a" } } });
    second.onChunk({ chunk: { type: "tool-call", toolCallId: "c2", toolName: "arsenalDeepResearch", input: { query: "b" } } });

    const snapshot = acc.snapshot();
    expect(snapshot.trustworthy).toBe(true);
    expect(snapshot.trustworthy ? snapshot.receipts.map((r) => r.toolName) : []).toEqual(["createTask", "arsenalDeepResearch"]);
    expect(firstHandler.toolReceipts?.()).toEqual(acc.snapshot());
    expect(secondHandler.toolReceipts?.()).toEqual(acc.snapshot());
  });

  // The errored row names the attempt by the id the error handler is built with, and the final row by
  // the id the finish handler is built with. Both must be the turn's own (the one the response header
  // carries), or Retry can never match a saved row to the attempt that failed.
  it("the error handler and the finish handler are both built with the turn's trace id", () => {
    // the route's persistBase carries the same id (route-tool-receipts-wiring.test.ts pins that)
    attemptOf(factory({ persistBase: { recordTrace: vi.fn(), traceId: "t1" } }));

    expect(handlerDeps().traceId).toBe("t1");
    const finishDeps = vi.mocked(buildOnFinish).mock.calls.at(-1)![0] as unknown as { traceId?: string };
    expect(finishDeps.traceId).toBe("t1");
  });

  it("a malformed onChunk event never throws into the stream", () => {
    const attempt = attemptOf(factory());
    expect(() => {
      attempt.onChunk(undefined);
      attempt.onChunk({});
      attempt.onChunk({ chunk: null });
    }).not.toThrow();
  });
});
