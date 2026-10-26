/**
 * 2026-10-26 · a tool-only chat turn always ends in prose.
 *
 * Live: an ollama/minimax-m3 turn ran all three standard steps, and the last
 * one (prepareStep toolChoice "none") still called tools, so the SDK stopped on
 * stepCountIs(3) with finishReason "tool-calls" and no text; the operator got the
 * empty-response fallback under eight tool cards. Ollama's OpenAI-compat surface
 * does not honour tool_choice, so "none" was a request, not a guarantee.
 *
 * The fake below is that provider: it ignores tool_choice and calls a tool
 * whenever tools are offered. Driven through the real buildStreamConfigFactory
 * (prepareStep + stopWhen) and the real ai@6 streamText loop.
 */
import { describe, it, expect, vi } from "vitest";
import { streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

vi.mock("@/lib/services/chat/stream-error-handler", () => ({ buildStreamErrorHandler: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({ buildOnFinish: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/ai/chat/repair-tool-call", () => ({ buildRepairToolCall: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/ai/tool-selection-telemetry", () => ({ noteForcedTool: vi.fn() }));

import { buildStreamConfigFactory } from "@/app/api/ai/chat/build-stream-config";

const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };
const START = { type: "stream-start", warnings: [] };
const streamOf = (parts: unknown[]) =>
  new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
const toolCallParts = (n: number, toolName = "getTasks") => [
  START,
  { type: "tool-call", toolCallId: `c${n}`, toolName, input: "{}" },
  { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
];
const textParts = (text: string) => [
  START,
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

type Call = { toolCount: number; toolChoice: unknown };
/** `decide(callIndex, toolsOffered)` -> parts. Records what each model call was sent. */
function fakeModel(decide: (i: number, toolsOffered: boolean) => unknown[]) {
  const calls: Call[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (opts: { tools?: unknown[]; toolChoice?: unknown }) => {
      const toolCount = opts.tools?.length ?? 0;
      calls.push({ toolCount, toolChoice: opts.toolChoice });
      return { stream: streamOf(decide(calls.length - 1, toolCount > 0)) } as never;
    },
  });
  return { model, calls };
}

function buildConfig(model: unknown, overrides: Record<string, unknown> = {}) {
  const getTasks = tool({
    description: "List tasks",
    inputSchema: z.object({}),
    execute: async () => ({ tasks: ["synthetic task"] }),
  });
  const build = buildStreamConfigFactory({
    persistBase: { recordTrace: vi.fn() } as never,
    provider: "ollama" as never,
    modelId: "fake-model",
    finalSystemPrompt: "system",
    sanitizedModelMessages: [{ role: "user", content: "a long synthetic journal entry" }],
    prunedTools: { getTasks },
    mode: "standard" as never,
    maxOutputTokens: 1000,
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
  return build(model as never) as Record<string, unknown>;
}

async function run(model: unknown, overrides: Record<string, unknown> = {}) {
  const config = buildConfig(model, overrides);
  const result = streamText({ ...config, maxRetries: 0 } as never);
  await result.consumeStream();
  return { text: await result.text, finishReason: await result.finishReason, steps: (await result.steps).length };
}

describe("the last allowed step is text-only even when the provider ignores tool_choice", () => {
  it("a provider that calls tools whenever they are offered still ends the turn with prose", async () => {
    const { model, calls } = fakeModel((_i, offered) => (offered ? toolCallParts(_i) : textParts("Here is what I heard.")));
    const out = await run(model);

    expect(out.text).toBe("Here is what I heard.");
    expect(out.finishReason).toBe("stop");
    expect(out.steps).toBe(3);
    // Steps 0 and 1 keep their tools; the last step is sent none at all.
    expect(calls.map((c) => c.toolCount)).toEqual([1, 1, 0]);
  });

  it("belt: a model that emits a tool call even with no tools offered gets ONE more text-only step", async () => {
    const { model, calls } = fakeModel((i) => (i < 3 ? toolCallParts(i) : textParts("Closing reply.")));
    const out = await run(model);

    expect(out.text).toBe("Closing reply.");
    expect(out.steps).toBe(4);
    expect(calls.map((c) => c.toolCount)).toEqual([1, 1, 0, 0]);
  });

  it("the strip covers every branch of the toolChoice ladder (web pin, action force, default)", () => {
    const arsenalWebSearch = tool({ description: "web", inputSchema: z.object({}), execute: async () => ({}) });
    const createTask = tool({ description: "write", inputSchema: z.object({}), execute: async () => ({}) });
    const prunedTools = { arsenalWebSearch, createTask };
    const branches = [
      { webSearchIntent: true, prunedTools },
      { actionIntent: { intent: "create_task", expectedTool: "createTask" }, prunedTools },
      { prunedTools },
    ];
    for (const b of branches) {
      const cfg = buildConfig({ modelId: "fake-model" }, b) as { prepareStep: (a: { stepNumber: number }) => unknown };
      expect(cfg.prepareStep({ stepNumber: 2 })).toEqual({ toolChoice: "none", activeTools: [] });
    }
  });

  // Codex P1 on PR 3296 (vercel/ai#13448: activeTools once filtered only what the
  // provider saw, and the full map still executed). ai@6.0.309 builds the step's
  // parse-and-execute set from activeTools; these pin that, so a downgrade or a
  // strip that stops sending activeTools goes red.
  it("a known tool call returned on a stripped step is never executed", async () => {
    const execute = vi.fn(async () => ({ tasks: ["synthetic task"] }));
    const getTasks = tool({ description: "List tasks", inputSchema: z.object({}), execute });
    const { model } = fakeModel((i) => (i < 3 ? toolCallParts(i) : textParts("Closing reply.")));
    const out = await run(model, { prunedTools: { getTasks } });

    expect(out.text).toBe("Closing reply.");
    // Steps 0 and 1 offered the tool and ran it; steps 2 and 3 offered none.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("the real name-repair lane cannot route a stripped step's call onto a live tool", async () => {
    const { buildRepairToolCall: realRepair } = await vi.importActual<typeof import("@/lib/ai/chat/repair-tool-call")>(
      "@/lib/ai/chat/repair-tool-call",
    );
    const execute = vi.fn(async () => ({ ok: true }));
    const createTask = tool({ description: "write", inputSchema: z.object({}), execute });
    const prunedTools = { createTask };
    // "task.create" is a curated alias the repair maps onto createTask.
    const { model } = fakeModel((i) => (i < 3 ? toolCallParts(i, "task.create") : textParts("Closing reply.")));
    const config = buildConfig(model, { prunedTools });
    const result = streamText({ ...config, experimental_repairToolCall: realRepair(prunedTools as never), maxRetries: 0 } as never);
    await result.consumeStream();

    expect(await result.text).toBe("Closing reply.");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("CONTROL · a normal tool turn (tools on step 0, prose on step 1) is unchanged: two steps, tools offered on both", async () => {
    const { model, calls } = fakeModel((i) => (i === 0 ? toolCallParts(i) : textParts("Done reading.")));
    const out = await run(model);

    expect(out.text).toBe("Done reading.");
    expect(out.steps).toBe(2);
    expect(calls.map((c) => c.toolCount)).toEqual([1, 1]);
  });

  it("CONTROL · anthropic keeps its tool definitions on the last step (it honours tool_choice none natively, and rejects tool history without them)", () => {
    const cfg = buildConfig({ modelId: "fake-model" }, { provider: "anthropic" }) as {
      prepareStep: (a: { stepNumber: number }) => unknown;
    };
    expect(cfg.prepareStep({ stepNumber: 2 })).toEqual({ toolChoice: "none" });
  });
});
