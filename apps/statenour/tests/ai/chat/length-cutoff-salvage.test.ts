/**
 * 2026-10-26 · a reply that hit the output cap before writing a word gets one
 * bounded text-only retry before the fallback copy.
 *
 * Live: ollama/minimax-m3 spent the whole 6,000-token budget on hidden thinking
 * (the @ai-sdk/openai chat model never surfaces Ollama's reasoning, so rT=0),
 * finished "length" with zero visible text, and persisted the generic fallback.
 * Driven through the real buildStreamConfigFactory onFinish and the real ai@6
 * streamText; the persist callback is mocked to capture the event it is handed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamText, tool } from "ai";
import { z } from "zod";
import { MockLanguageModelV3 } from "ai/test";

const h = vi.hoisted(() => ({ persisted: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/services/chat/stream-error-handler", () => ({ buildStreamErrorHandler: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({
  buildOnFinish: vi.fn(() => async (event: Record<string, unknown>) => {
    h.persisted.push(event);
  }),
}));
vi.mock("@/lib/ai/chat/repair-tool-call", () => ({ buildRepairToolCall: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/ai/tool-selection-telemetry", () => ({ noteForcedTool: vi.fn() }));

import { buildStreamConfigFactory } from "@/app/api/ai/chat/build-stream-config";

const START = { type: "stream-start", warnings: [] };
const streamOf = (parts: unknown[]) =>
  new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
const LENGTH_NO_TEXT = [
  START,
  { type: "finish", finishReason: { unified: "length", raw: "length" }, usage: { inputTokens: { total: 21512 }, outputTokens: { total: 6000 } } },
];
const TEXT = (t: string) => [
  START,
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: t },
  { type: "text-end", id: "t" },
  { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } },
];

function fake(streamParts: unknown[], salvageText: string) {
  const generateCalls: Array<{ toolCount: number; providerOptions: unknown; maxOutputTokens?: number }> = [];
  const model = new MockLanguageModelV3({
    doStream: async () => ({ stream: streamOf(streamParts) }) as never,
    doGenerate: async (opts: { tools?: unknown[]; providerOptions?: unknown; maxOutputTokens?: number }) => {
      generateCalls.push({ toolCount: opts.tools?.length ?? 0, providerOptions: opts.providerOptions, maxOutputTokens: opts.maxOutputTokens });
      return {
        content: salvageText ? [{ type: "text", text: salvageText }] : [],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      } as never;
    },
  });
  return { model, generateCalls };
}

async function run(model: unknown, overrides: Record<string, unknown> = {}) {
  const build = buildStreamConfigFactory({
    persistBase: { recordTrace: vi.fn() } as never,
    provider: "ollama" as never,
    modelId: "fake-model",
    finalSystemPrompt: "system",
    sanitizedModelMessages: [{ role: "user", content: "a synthetic message" }],
    prunedTools: {},
    mode: "standard" as never,
    maxOutputTokens: 6000,
    turnSignal: { temperature: 0.7 } as never,
    webSearchIntent: false,
    actionIntent: null,
    actionPermission: undefined,
    privateMode: false,
    convId: "c1",
    conversationId: "conv-1",
    traceId: "t1",
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    partialRef: { text: "" },
    recordTrace: vi.fn() as never,
    resolveOnFinish: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    ...overrides,
  } as never);
  const result = streamText({ ...(build(model as never) as Record<string, unknown>), maxRetries: 0 } as never);
  await result.consumeStream();
  await vi.waitFor(() => expect(h.persisted.length).toBe(1));
  return h.persisted[0]!;
}

beforeEach(() => {
  h.persisted = [];
});

describe("a reply cut off by the output cap before any text is salvaged once", () => {
  it("finish 'length' with zero visible text: persist receives the salvage reply, not an empty turn", async () => {
    const { model, generateCalls } = fake(LENGTH_NO_TEXT, "A short, direct reply.");
    const event = await run(model);

    expect(event.text).toBe("A short, direct reply.");
    expect(event.finishReason).toBe("stop");
    // One bounded call: no tools, thinking turned down, a smaller budget than the turn's.
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]!.toolCount).toBe(0);
    expect(generateCalls[0]!.providerOptions).toMatchObject({ openai: { reasoningEffort: "none" } });
    expect(generateCalls[0]!.maxOutputTokens).toBeLessThan(6000);
  });

  it("a salvage that also comes back empty leaves the event as it was (the fallback copy still applies)", async () => {
    const { model, generateCalls } = fake(LENGTH_NO_TEXT, "");
    const event = await run(model);

    expect(generateCalls).toHaveLength(1);
    expect(event.text).toBe("");
    expect(event.finishReason).toBe("length");
    // The empty retry still spent tokens.
    expect(event.usage).toMatchObject({ inputTokens: 21512 + 1, outputTokens: 6000 + 1 });
  });

  // Codex P2 on PR 3296: the retry's tokens were dropped, so cost rows and
  // AiGeneration totals undercounted the turn.
  it("the persisted usage is the cut-off attempt plus the retry", async () => {
    const { model } = fake(LENGTH_NO_TEXT, "A short, direct reply.");
    const event = await run(model);

    expect(event.usage).toMatchObject({ inputTokens: 21512 + 1, outputTokens: 6000 + 1, totalTokens: 27512 + 2 });
  });

  // Codex P2 on PR 3296: a private turn writes no row and emits no
  // message.persisted, so a retry's text could never reach the screen.
  it("a private turn cut off by the cap makes no retry and logs why", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { model, generateCalls } = fake(LENGTH_NO_TEXT, "never shown");
    const event = await run(model, { privateMode: true, log });

    expect(generateCalls).toHaveLength(0);
    expect(log.info).toHaveBeenCalledWith("length_cutoff_salvage_skipped_private", expect.anything());
    expect(event.text).toBe("");
  });

  // Live 2026-11-01 12:57Z: a personal message ran 9 read tools, the text-only
  // step hit the 6,000 cap with no text, and the retry threw AI_InvalidPromptError
  // (log length_cutoff_salvage_failed), so the "too heavy" copy persisted.
  // searchMemories returns Prisma `updatedAt` as a Date; the tool-result part
  // carries it as-is, and generateText's ModelMessage schema rejects a Date.
  it("tool steps whose results hold a Date, then a cut-off text step: the retry still runs", async () => {
    const tools = {
      searchMemories: tool({
        inputSchema: z.object({ query: z.string() }),
        execute: async () => ({ count: 1, memories: [{ id: "m1", content: "a memory", updatedAt: new Date("2026-10-31T12:00:00Z") }] }),
      }),
    };
    const TOOL_CALL = [
      START,
      { type: "tool-call", toolCallId: "c1", toolName: "searchMemories", input: JSON.stringify({ query: "staff" }) },
      { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } },
    ];
    const streams = [TOOL_CALL, LENGTH_NO_TEXT];
    let call = 0;
    const generated: unknown[] = [];
    const model = new MockLanguageModelV3({
      doStream: async () => ({ stream: streamOf(streams[Math.min(call++, streams.length - 1)]!) }) as never,
      doGenerate: async (opts: { prompt: unknown }) => {
        generated.push(opts.prompt);
        return {
          content: [{ type: "text", text: "A short, direct reply." }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        } as never;
      },
    });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const event = await run(model, { prunedTools: tools, log });

    expect(log.warn).not.toHaveBeenCalledWith("length_cutoff_salvage_failed", expect.anything());
    expect(generated).toHaveLength(1);
    expect(event.text).toBe("A short, direct reply.");
    // The retry still sees the tool result, with the date as the provider saw it.
    expect(JSON.stringify(generated[0])).toContain("2026-10-31T12:00:00.000Z");
  });

  it("CONTROL · a normal text turn is untouched and makes no extra call", async () => {
    const { model, generateCalls } = fake(TEXT("Normal reply."), "never used");
    const event = await run(model);

    expect(event.text).toBe("Normal reply.");
    expect(event.finishReason).toBe("stop");
    expect(generateCalls).toHaveLength(0);
  });
});
