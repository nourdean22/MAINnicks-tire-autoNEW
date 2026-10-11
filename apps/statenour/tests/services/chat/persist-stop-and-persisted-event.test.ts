/**
 * persistAssistantMessage / buildOnFinish - operator-stop state + persisted-event
 * hand-off (audit 04-F6, 04-F2, 2026-10-10). Drives the REAL functions.
 *
 *   - a turn the operator stopped (stop row for THIS traceId) persists as
 *     `aborted`; any other turn keeps its finish-reason state;
 *   - ONE announcement per turn, after post-persist verification: the SSE
 *     stream for this trace is handed `{ id, content }` with the FINAL stored
 *     text (the L2 fabrication banner included), never the pre-banner text;
 *   - a row that was not written (P2002 duplicate) is never announced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  claim: vi.fn(),
  holder: vi.fn(),
  notify: vi.fn(),
  postVerify: vi.fn(),
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
  const prisma: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "chatMessage") {
          return {
            ...passthrough,
            findFirst: (a: unknown) => h.findFirst(a),
            create: (a: unknown) => h.create(a),
          };
        }
        // The stop slot: persist claims it (create), and reads its holder on P2002.
        if (prop === "brainMemory") {
          return { ...passthrough, create: (a: unknown) => h.claim(a), findUnique: (a: unknown) => h.holder(a) };
        }
        if (prop === "$transaction") return (fn: (tx: unknown) => unknown) => fn(prisma);
        if (prop === "$queryRaw" || prop === "$executeRaw") return () => Promise.resolve([]);
        return passthrough;
      },
    },
  );
  return { prisma };
});
vi.mock("@/lib/ai/runtime/sse-stream", () => ({
  notifyMessagePersisted: (t: string, p: unknown) => h.notify(t, p),
}));
vi.mock("@/lib/ai/chat/calibration-enforcer", () => ({
  enforceCalibration: async (_u: string, text: string) => ({ action: "skipped", text }),
}));
vi.mock("@/lib/ai/judge-eval", () => ({ judgeReplyAsync: async () => null }));
vi.mock("@/lib/ai/adversarial-critic", () => ({ criticizeAsync: async () => null }));
vi.mock("@/lib/evals/q32-regression", () => ({ selectQ32Turn: () => null }));
vi.mock("@/lib/observability/langfuse-annotation-queue", () => ({
  enqueueLangfuseTraceForAnnotation: async () => false,
}));
vi.mock("@/lib/errors/record-error", () => ({
  withErrorCapture: async (_s: string, fn: () => unknown) => {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  },
  recordError: vi.fn(),
}));
vi.mock("@/lib/logger", () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { logger: { withSurface: () => noop, ...noop } };
});
vi.mock("@/lib/services/chat/post-persist-verification", () => ({
  runPostPersistVerification: (a: unknown) => h.postVerify(a),
}));
vi.mock("@/lib/services/chat/post-turn-outbox", () => ({
  enqueuePostTurnWork: async () => "outbox-1",
  completePostTurnWork: async () => undefined,
}));
vi.mock("@/lib/services/chat/deferred-background-work", () => ({
  runDeferredBackgroundWork: async () => undefined,
}));

import { persistAssistantMessage } from "@/lib/services/chat/persist-assistant-message";
import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";

const log = { info: vi.fn(), warn: vi.fn() };

function args(overrides: Record<string, unknown> = {}) {
  return {
    hasContent: true,
    hasToolCalls: false,
    cleanedText: "Here is the plan for the week.",
    reasoningText: "",
    finishReason: "stop",
    usage: undefined,
    convId: "conv-1",
    traceId: "T1",
    provider: "anthropic",
    modelId: "m",
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    capturedToolCalls: [],
    truthFlags: [],
    critic: null,
    citations: [],
    gate: null,
    factClaims: [],
    unverifiedCount: 0,
    turnSignal: {
      complexity: "simple",
      intent: "chat",
      outputShape: "prose",
      urgency: "normal",
      temperature: 0.5,
      useChainOfThought: false,
    },
    contextBlocksFired: {},
    deeperContextCount: 0,
    deeperContextTypes: [],
    personality: "nick",
    userContent: "plan my week",
    posture: undefined,
    log,
    ...overrides,
  } as unknown as Parameters<typeof persistAssistantMessage>[0];
}

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const deps = () =>
  ({
    log: noopLog,
    conversationId: "conv-1",
    convId: "conv-1",
    provider: "anthropic",
    modelId: "m",
    model: "m",
    mode: "standard",
    personality: "nick",
    contentMode: null,
    finalSystemPrompt: "sys",
    systemPrompt: "sys",
    finalTaskType: "reason",
    userContent: "add milk to the list",
    turnSignal: { temperature: 0.5, intent: "chat", outputShape: "prose" },
    contextBlocksFired: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    traceId: "T1",
    recordTrace: vi.fn(),
    messages: [],
    topicTier: null,
    modeOverride: null,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.findFirst.mockResolvedValue(null);
  h.create.mockResolvedValue({ id: "msg-1" });
  h.claim.mockResolvedValue({ id: "claim" });
  h.holder.mockResolvedValue(null);
  h.postVerify.mockImplementation(async (a: { cleanedText: string }) => ({ cleanedText: a.cleanedText }));
});

const createdState = () =>
  (h.create.mock.calls[0]![0] as { data: { streamingState: string } }).data.streamingState;

describe("operator stop", () => {
  it("a turn the operator stopped persists as aborted, and the stop slot is keyed to THIS turn", async () => {
    // The Stop wrote its marker first: persist's claim on the same key fails.
    h.claim.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    h.holder.mockResolvedValue({ source: "chat-stop" });
    await persistAssistantMessage(args());
    expect(h.claim).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: "stop:conv-1:T1" }) }),
    );
    expect(createdState()).toBe("aborted");
  });

  it("CONTROL: an unstopped turn keeps its finish-reason state", async () => {
    await persistAssistantMessage(args());
    expect(createdState()).toBe("complete");
  });
});

describe("message.persisted - one announcement, with the FINAL text (04-F2)", () => {
  const BANNER = "<!-- nick-verifier --> unverified claim\n\n";

  it("the announcement carries the post-verification text: the L2 banner reaches the bubble", async () => {
    h.postVerify.mockImplementation(async (a: { cleanedText: string }) => ({ cleanedText: `${BANNER}${a.cleanedText}` }));
    await buildOnFinish(deps())({ text: "Added milk to your list.", finishReason: "stop" } as never);
    const last = h.notify.mock.calls.at(-1);
    expect(last?.[0]).toBe("T1");
    expect((last?.[1] as { id: string; content: string }).id).toBe("msg-1");
    expect((last?.[1] as { content: string }).content.startsWith(BANNER)).toBe(true);
  });

  it("the turn is announced exactly once", async () => {
    await buildOnFinish(deps())({ text: "Added milk to your list.", finishReason: "stop" } as never);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith("T1", { id: "msg-1", content: "Added milk to your list." });
  });

  it("a row that was NOT written (P2002 duplicate) is never announced", async () => {
    h.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await buildOnFinish(deps())({ text: "Added milk to your list.", finishReason: "stop" } as never);
    expect(h.create).toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });
});
