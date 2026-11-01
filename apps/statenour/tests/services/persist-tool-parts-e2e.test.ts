/**
 * B1 consumer end (2026-11-01): the stream's onFinish steps reach the row it creates.
 *
 * message-parts-tool-persistence.test.ts proves the producer; only this file fails if
 * persist-assistant-turn stops building the tool parts or stops handing them to
 * persistAssistantMessage. Harness copied from persist-empty-tool-turn.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChatMessageCreate = vi.fn();
const mockChatMessageFindFirst = vi.fn(() => Promise.resolve(null as unknown));
vi.mock("@/lib/prisma", () => {
  // Every model method must return a real promise — the handler chains
  // .catch on fire-and-forget writes.
  const passthrough = {
    create: () => Promise.resolve({ id: "x" }),
    update: () => Promise.resolve({ id: "x" }),
    upsert: () => Promise.resolve({ id: "x" }),
    delete: () => Promise.resolve({ id: "x" }),
    findFirst: () => Promise.resolve(null),
    findUnique: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
    updateMany: () => Promise.resolve({ count: 0 }),
    createMany: () => Promise.resolve({ count: 0 }),
    groupBy: () => Promise.resolve([]),
  };
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === "chatMessage") {
            return {
              ...passthrough,
              findFirst: (args: unknown) => mockChatMessageFindFirst(args),
              create: (args: unknown) => {
                mockChatMessageCreate(args);
                return Promise.resolve({ id: "m-1" });
              },
            };
          }
          if (prop === "$queryRaw" || prop === "$executeRaw") {
            return () => Promise.resolve([]);
          }
          return passthrough;
        },
      },
    ),
  };
});

const mockRecordError = vi.fn();
vi.mock("@/lib/errors/record-error", () => ({
  recordError: (...a: unknown[]) => mockRecordError(...a),
  // Fire-and-forget wrapper used by post-process blocks — noop so the
  // critical persist path is the only thing under test.
  withErrorCapture: (_label: string, fn: () => unknown) => {
    try {
      void fn();
    } catch {
      /* swallowed like the real wrapper */
    }
  },
}));

vi.mock("@/lib/logger", () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { logger: { withSurface: () => noop, ...noop } };
});

import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";


const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeDeps() {
  return {
    log: noopLog,
    conversationId: "conv-1",
    convId: "conv-1",
    provider: "ollama",
    modelId: "deepseek-v4-pro",
    model: "deepseek-v4-pro",
    mode: "standard",
    personality: "nick",
    contentMode: null,
    finalSystemPrompt: "sys",
    systemPrompt: "sys",
    finalTaskType: "reason",
    userContent: "short ask",
    turnSignal: { temperature: 0.5 },
    contextBlocksFired: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    startedAt: Date.now(),
    firstTokenRef: { current: null },
    traceId: "t_test",
    recordTrace: vi.fn(),
    messages: [],
    topicTier: null,
    modeOverride: null,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

type CreatedRow = { data: { content: string; parts?: Array<{ type: string; state?: string; toolCallId?: string }> } };

describe("persist-assistant-turn · a tool turn's row keeps its tool parts (B1)", () => {
  it("stores one UI tool part per call, in the order they ran, then the reply text", async () => {
    const onFinish = buildOnFinish(makeDeps());

    await onFinish({
      text: "You have 2 open tasks.",
      finishReason: "stop",
      steps: [
        {
          toolCalls: [{ toolCallId: "c1", toolName: "getTasks", input: { status: "open" } }],
          toolResults: [{ toolCallId: "c1", toolName: "getTasks", input: { status: "open" }, output: { tasks: [{ id: "a" }, { id: "b" }] } }],
          content: [],
        },
        {
          toolCalls: [{ toolCallId: "c2", toolName: "searchMemories", input: { q: "tires" } }],
          toolResults: [{ toolCallId: "c2", toolName: "searchMemories", input: { q: "tires" }, output: { results: [] } }],
          content: [],
        },
      ],
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    } as never);

    const created = mockChatMessageCreate.mock.calls[0][0] as CreatedRow;
    expect(created.data.parts?.map((p) => [p.type, p.toolCallId, p.state])).toEqual([
      ["tool-getTasks", "c1", "output-available"],
      ["tool-searchMemories", "c2", "output-available"],
      ["text", undefined, undefined],
    ]);
  });

  it("POSITIVE CONTROL: a turn with no steps stores text only", async () => {
    const onFinish = buildOnFinish(makeDeps());
    await onFinish({ text: "Hello there.", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } } as never);
    const created = mockChatMessageCreate.mock.calls[0][0] as CreatedRow;
    expect(created.data.parts?.map((p) => p.type)).toEqual(["text"]);
  });
});
