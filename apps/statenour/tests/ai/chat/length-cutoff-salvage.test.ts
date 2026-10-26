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
import { streamText } from "ai";
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

async function run(model: unknown) {
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
  });

  it("CONTROL · a normal text turn is untouched and makes no extra call", async () => {
    const { model, generateCalls } = fake(TEXT("Normal reply."), "never used");
    const event = await run(model);

    expect(event.text).toBe("Normal reply.");
    expect(event.finishReason).toBe("stop");
    expect(generateCalls).toHaveLength(0);
  });
});
