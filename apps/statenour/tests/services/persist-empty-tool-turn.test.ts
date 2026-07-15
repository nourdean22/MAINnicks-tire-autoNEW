/**
 * Silent-tool-turn pin (2026-07-15).
 *
 * The empty-response guard in persist-assistant-turn was gated with
 * `&& !hasToolCalls`, making emptyResponseFallback's dedicated
 * finishReason === "tool-calls" branch unreachable — a tool turn whose
 * post-tool continuation returned empty text persisted a "complete"
 * row with EMPTY content (blank bubble, no error card; operator had to
 * nudge with "?"). Trigger: deepseek-v4-pro burning the output budget
 * on non-excludable reasoning under heavy prompts.
 *
 * Pins:
 *   1. empty text + tool calls → the persisted row carries the
 *      tool-calls fallback message (not "")
 *   2. non-empty text is persisted untouched (guard doesn't over-fire)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChatMessageCreate = vi.fn();
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
import { emptyResponseFallback } from "@/lib/ai/chat/empty-response-fallback";

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

describe("persist-assistant-turn · empty tool-turn fallback", () => {
  it("persists the tool-calls fallback message when a tool turn ends with empty text", async () => {
    const onFinish = buildOnFinish(makeDeps());

    await onFinish({
      text: "",
      finishReason: "tool-calls",
      toolCalls: [{ toolName: "createTask" }],
      toolResults: [{ toolName: "createTask", result: { ok: true } }],
      usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
    } as never);

    expect(mockChatMessageCreate).toHaveBeenCalled();
    const created = mockChatMessageCreate.mock.calls[0][0] as { data: { content: string } };
    const expected = emptyResponseFallback("tool-calls");
    expect(expected.length).toBeGreaterThan(0);
    expect(created.data.content).toBe(expected);
  });

  it("persists real text untouched (guard does not over-fire)", async () => {
    const onFinish = buildOnFinish(makeDeps());

    await onFinish({
      text: "Task created — anything else?",
      finishReason: "stop",
      toolCalls: [{ toolName: "createTask" }],
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    } as never);

    expect(mockChatMessageCreate).toHaveBeenCalled();
    const created = mockChatMessageCreate.mock.calls[0][0] as { data: { content: string } };
    expect(created.data.content).toContain("Task created");
  });
});
