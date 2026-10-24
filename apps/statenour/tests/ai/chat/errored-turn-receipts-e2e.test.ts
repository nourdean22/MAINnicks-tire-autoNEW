/**
 * The errored row against the REAL ai SDK. ai@6 does not treat an error part as
 * terminal: the model stream can go on to emit a tool-call and finish(tool-calls),
 * and the tool then executes (executeToolCallAfterFinish, runToolsTransformation).
 * So a snapshot taken at the first error part that wrote toolReceipts: [] claimed
 * "nothing ran" while a write was about to run, and Retry would have re-run it.
 *
 * This drives streamText with MockLanguageModelV3 through the real
 * buildStreamConfigFactory (onChunk -> accumulator) and the real
 * buildStreamErrorHandler, ended by terminateWhenDrained as the route calls it. The route's
 * own half (it hands the factory the record and drains it) is driven through the real POST
 * handler in route-tool-receipts-wiring.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { create: (a: unknown) => h.create(a), update: (a: unknown) => h.update(a) },
    errorLog: { create: () => Promise.resolve({}) },
  },
}));
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  markProviderFailed: vi.fn(),
  markProviderQuotaExhausted: vi.fn(),
}));
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({ buildOnFinish: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/ai/chat/repair-tool-call", () => ({ buildRepairToolCall: vi.fn(() => vi.fn()) }));

import { buildStreamConfigFactory } from "@/app/api/ai/chat/build-stream-config";
import { createInFlightToolCalls, terminateWhenDrained } from "@/lib/services/chat/in-flight-tool-calls";
import { turnHasSideEffect } from "@/features/chat-v2/lib/turn-side-effect";
import { judgeSavedTurn } from "@/features/chat-v2/lib/saved-turn";
import type { UIMessage } from "ai";

const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };
const START = { type: "stream-start", warnings: [] };
const ERROR_PART = { type: "error", error: new Error("provider dropped mid-stream") };
const TOOL_CALL = { type: "tool-call", toolCallId: "c1", toolName: "createTask", input: JSON.stringify({ title: "Call Mike" }) };
const FINISH_TOOL_CALLS = { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage };
const FINISH_STOP = { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage };

const streamOf = (parts: unknown[]) =>
  new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });

/** One entry per model call: parts to stream, or an Error to throw from doStream. */
async function runTurn(calls: Array<unknown[] | Error>) {
  let executed = 0;
  let n = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      const next = calls[Math.min(n++, calls.length - 1)];
      if (next instanceof Error) throw next;
      return { stream: streamOf(next) };
    },
  });
  const createTask = tool({
    description: "Create a task",
    inputSchema: z.object({ title: z.string() }),
    execute: async () => {
      executed += 1;
      return { ok: true };
    },
  });
  const acc = createInFlightToolCalls();
  const build = buildStreamConfigFactory({
    persistBase: { recordTrace: vi.fn() } as never,
    provider: "ollama" as never,
    modelId: "mock-model",
    finalSystemPrompt: "system",
    sanitizedModelMessages: [{ role: "user", content: "add a task" }],
    prunedTools: { createTask },
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
    toolCalls: acc,
  } as never);

  const config = build(model as never) as Record<string, unknown>;
  const result = streamText({ ...config, maxRetries: 0 } as never);
  terminateWhenDrained(acc, result.consumeStream());
  await vi.waitFor(() => expect(acc.snapshot()).toMatchObject({ terminal: true }));
  // the settle callback runs right after terminate(); let it finish
  await new Promise((r) => setTimeout(r, 20));
  return { acc, executed: () => executed };
}

const createdUsage = () => (h.create.mock.calls[0]![0] as { data: { tokenUsage: unknown } }).data.tokenUsage;
const finalUsage = () => (h.update.mock.calls.at(-1)![0] as { data: { tokenUsage: unknown } }).data.tokenUsage;
const erroredBubble = (tokenUsage: unknown) =>
  ({ id: "db-1", role: "assistant", parts: [{ type: "text", text: "partial" }], streamingState: "errored", tokenUsage }) as unknown as UIMessage;

beforeEach(() => {
  vi.clearAllMocks();
  h.create.mockResolvedValue({ id: "stub-1" });
  h.update.mockResolvedValue({ id: "stub-1" });
});

describe("an error part is not the end of the stream", () => {
  it("POSITIVE CONTROL: after an error part a tool-call plus finish(tool-calls) still executes the write", async () => {
    const turn = await runTurn([[START, ERROR_PART, TOOL_CALL, FINISH_TOOL_CALLS], [START, FINISH_STOP]]);

    expect(turn.executed()).toBe(1);
  });

  it("the row written at the error part does NOT claim 'nothing ran'; the write is recorded once the stream ends", async () => {
    const turn = await runTurn([[START, ERROR_PART, TOOL_CALL, FINISH_TOOL_CALLS], [START, FINISH_STOP]]);

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(createdUsage()).toEqual({ traceId: "t1", receiptsUnavailable: true });
    expect(createdUsage()).not.toHaveProperty("toolReceipts");

    expect(turn.executed()).toBe(1);
    expect(finalUsage()).toMatchObject({ toolReceipts: [{ toolName: "createTask", sideEffecting: true }] });
    // ...and the Retry gate refuses both the row as first written and as settled
    expect(turnHasSideEffect(erroredBubble(createdUsage()))).toBe(true);
    expect(turnHasSideEffect(erroredBubble(finalUsage()))).toBe(true);
  });
});

describe("a cold failure (no tool ever started)", () => {
  it("doStream rejecting: first the row says unavailable, then it is settled to [] and Retry is safe", async () => {
    const turn = await runTurn([new Error("connect refused")]);

    expect(turn.executed()).toBe(0);
    expect(createdUsage()).toEqual({ traceId: "t1", receiptsUnavailable: true });
    expect(finalUsage()).toEqual({ traceId: "t1", toolReceipts: [] });
    expect(turnHasSideEffect(erroredBubble(createdUsage()))).toBe(true);
    expect(turnHasSideEffect(erroredBubble(finalUsage()))).toBe(false);
  });

  it("an error part before any content settles the same way", async () => {
    await runTurn([[START, ERROR_PART]]);

    expect(createdUsage()).toEqual({ traceId: "t1", receiptsUnavailable: true });
    expect(finalUsage()).toEqual({ traceId: "t1", toolReceipts: [] });
  });

  // The writer (the real handler) and the consumer (what Retry reads) meet here: the row the
  // handler wrote names its attempt, and the judge accepts it only for that attempt.
  it("the settled row is safe for the attempt that wrote it (trace t1) and not for the next one (t2)", async () => {
    await runTurn([new Error("connect refused")]);
    const saved = [{ id: "u1", role: "user" }, { id: "stub-1", role: "assistant", content: "", streamingState: "errored", tokenUsage: finalUsage() }];

    expect(judgeSavedTurn(saved, "t1")).toBe("safe");
    expect(judgeSavedTurn(saved, "t2"), "attempt 2 has no row of its own yet").toBe("unconfirmed");
  });
});

describe("real SDK chunks are readable by the accumulator (positive control for observe)", () => {
  it("a clean tool turn: the real tool-call and tool-result chunks keep the record trustworthy and list the write", async () => {
    const turn = await runTurn([[START, TOOL_CALL, FINISH_TOOL_CALLS], [START, FINISH_STOP]]);

    expect(turn.executed()).toBe(1);
    expect(h.create).not.toHaveBeenCalled();
    expect(turn.acc.snapshot()).toMatchObject({
      trustworthy: true,
      terminal: true,
      receipts: [{ toolName: "createTask", sideEffecting: true }],
    });
  });
});
