/**
 * buildOnFinish forwards event.laneTelemetrySteps into the tool-telemetry walk.
 *
 * The sampled lanes (regen, self-consistency) hand the persist pipeline the
 * winning generation's steps as laneTelemetrySteps. Tests that reach the walk
 * directly, or through a mocked buildOnFinish, stay green if the forwarding
 * line in persist-assistant-turn.ts is deleted. This one runs the REAL
 * buildOnFinish and asserts the call reaches the tool_telemetry recorder.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  recordToolInvocation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => {
  const passthrough = {
    create: () => Promise.resolve({ id: "x" }),
    update: () => Promise.resolve({ id: "x" }),
    upsert: () => Promise.resolve({ id: "x" }),
    findFirst: () => Promise.resolve(null),
    findUnique: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
    updateMany: () => Promise.resolve({ count: 0 }),
    groupBy: () => Promise.resolve([]),
  };
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === "chatMessage") return { ...passthrough, create: () => Promise.resolve({ id: "m-1" }) };
          if (prop === "$queryRaw" || prop === "$executeRaw") return () => Promise.resolve([]);
          return passthrough;
        },
      },
    ),
  };
});
vi.mock("@/lib/errors/record-error", () => ({
  recordError: vi.fn(),
  withErrorCapture: async (_l: string, fn: () => unknown) => {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  },
}));
vi.mock("@/lib/logger", () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { logger: { withSurface: () => noop, ...noop } };
});
vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: false }) }));
vi.mock("@/lib/ai/tool-telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/tool-telemetry")>()),
  recordToolInvocation: h.recordToolInvocation,
}));
vi.mock("@/lib/services/metrics", () => ({
  recordMetric: vi.fn().mockResolvedValue(undefined),
  recordMetricStrict: vi.fn().mockResolvedValue({ id: "m" }),
}));
vi.mock("@/lib/services/chat/post-persist-verification", () => ({
  runPostPersistVerification: async (a: { cleanedText: string }) => ({ cleanedText: a.cleanedText }),
}));
vi.mock("@/lib/services/chat/post-turn-outbox", () => ({
  enqueuePostTurnWork: async () => "outbox-1",
  completePostTurnWork: async () => undefined,
}));
vi.mock("@/lib/services/chat/deferred-background-work", () => ({
  runDeferredBackgroundWork: async () => undefined,
}));
vi.mock("@/lib/ai/runtime/sse-stream", () => ({ notifyMessagePersisted: () => false }));

import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const deps = () =>
  ({
    log: noopLog,
    conversationId: "conv-1",
    convId: "conv-1",
    provider: "ollama",
    modelId: "m",
    model: "m",
    mode: "standard",
    personality: "nick",
    contentMode: null,
    finalSystemPrompt: "sys",
    systemPrompt: "sys",
    finalTaskType: "reason",
    userContent: "what commitments are open this week?",
    turnSignal: { temperature: 0.5, intent: "factual", outputShape: "prose" },
    contextBlocksFired: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    traceId: "t_lane",
    recordTrace: vi.fn(),
    messages: [],
    topicTier: null,
    modeOverride: null,
  }) as never;

const REPLY = "There are 4 open commitments this week, 1 of them overdue and waiting on a call back.";
const step = {
  toolCalls: [{ toolName: "getCommitments", toolCallId: "tc-1", input: {} }],
  toolResults: [{ toolName: "getCommitments", toolCallId: "tc-1", output: { items: [] } }],
};

beforeEach(() => {
  h.recordToolInvocation.mockClear();
});

describe("buildOnFinish - laneTelemetrySteps", () => {
  it("a sampled lane's winning steps reach the tool_telemetry recorder exactly once", async () => {
    await buildOnFinish(deps())({ text: REPLY, finishReason: "stop", laneName: "regen", laneTelemetrySteps: [step] } as never);
    expect(h.recordToolInvocation).toHaveBeenCalledTimes(1);
    expect(h.recordToolInvocation).toHaveBeenCalledWith(expect.objectContaining({ toolName: "getCommitments", success: true }));
  }, 30_000);

  it("CONTROL - the same turn without laneTelemetrySteps records nothing, so the call above comes from the steps", async () => {
    await buildOnFinish(deps())({ text: REPLY, finishReason: "stop", laneName: "regen" } as never);
    expect(h.recordToolInvocation).not.toHaveBeenCalled();
  }, 30_000);
});
