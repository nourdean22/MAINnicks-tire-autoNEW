/**
 * 2026-11-01 · the forced text-only step on Ollama turns thinking off.
 *
 * Live 12:55-12:57Z (Langfuse trace e5d3344b): a personal message ran two tool
 * steps on ollama/minimax-m3 (3,459 and 5,691 output tokens, no visible text), then
 * the text-only step spent all 6,000 output tokens thinking at 42k input tokens and
 * wrote nothing. Probe the same day: Ollama's /v1 endpoint honours reasoning_effort
 * for minimax-m3 ("none": 0 thinking, 619 tokens at a 37k context; "low" spent MORE
 * than the default). So the last step sends reasoning_effort "none". Driven through
 * the real buildStreamConfigFactory, ai@6 streamText and the @ai-sdk/openai chat
 * adapter the Ollama lane uses; the request bodies are read off the wire.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

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
import { textOnlyStep } from "@/app/api/ai/chat/text-only-step";

const sse = (chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
const chunk = (delta: unknown, finish: string | null = null, usage?: unknown) => ({
  id: "x", object: "chat.completion.chunk", created: 1, model: "minimax-m3",
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(usage ? { usage } : {}),
});
const toolCallReply = (id: string) =>
  sse([
    chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: "searchMemories", arguments: "{\"query\":\"staff\"}" } }] }),
    chunk({}, "tool_calls", { prompt_tokens: 1, completion_tokens: 1 }),
  ]);
const textReply = (text: string) =>
  sse([chunk({ role: "assistant", content: text }), chunk({}, "stop", { prompt_tokens: 1, completion_tokens: 1 })]);

async function runTurn(provider: string, modelId = "minimax-m3") {
  const bodies: Array<Record<string, unknown>> = [];
  const replies = [toolCallReply("c1"), toolCallReply("c2"), textReply("Here is the plan.")];
  const model = createOpenAI({
    apiKey: "test",
    baseURL: "https://ollama.invalid/v1",
    fetch: (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return replies[Math.min(bodies.length - 1, replies.length - 1)]!;
    }) as never,
  }).chat(modelId);
  const build = buildStreamConfigFactory({
    persistBase: { recordTrace: vi.fn() } as never,
    provider: provider as never,
    modelId,
    finalSystemPrompt: "system",
    sanitizedModelMessages: [{ role: "user", content: "a synthetic message" }],
    prunedTools: {
      searchMemories: tool({ inputSchema: z.object({ query: z.string() }), execute: async () => ({ count: 0, memories: [] }) }),
    },
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
  return { bodies, event: h.persisted[0]! };
}

beforeEach(() => {
  h.persisted = [];
});

describe("the forced text-only step on Ollama runs without thinking", () => {
  it("the last step's request carries reasoning_effort 'none'; the tool steps keep the model's default", async () => {
    const { bodies, event } = await runTurn("ollama");

    expect(bodies).toHaveLength(3);
    expect(bodies.map((b) => b.reasoning_effort)).toEqual([undefined, undefined, "none"]);
    // Still the text-only step: no tools offered on it.
    expect(bodies[2]!.tools).toBeUndefined();
    expect(event.text).toBe("Here is the plan.");
  });

  // The lane is read from the model that actually serves the turn (inferProviderName),
  // so the control swaps the model, not just the requested provider.
  it("CONTROL · a model outside the Ollama lane gets no reasoning_effort on any step", async () => {
    const { bodies } = await runTurn("openai", "gpt-4o-mini");

    expect(bodies.map((b) => b.reasoning_effort)).toEqual([undefined, undefined, undefined]);
  });

  // Second reader 2026-11-01: the controls above never reach the strip branch. These do
  // (activeTools [] proves it), so dropping the ollama check turns this red.
  it("CONTROL · other strip-branch lanes keep the strip but get no reasoning_effort", () => {
    for (const p of ["openrouter", "venice", "emergency", null]) {
      const s = textOnlyStep(p);
      expect(s.activeTools).toEqual([]);
      expect(s).not.toHaveProperty("providerOptions");
    }
  });

  it("CONTROL · native tool_choice providers are unchanged", () => {
    for (const p of ["anthropic", "gemini", "openai"]) expect(textOnlyStep(p)).toEqual({ toolChoice: "none" });
  });
});
