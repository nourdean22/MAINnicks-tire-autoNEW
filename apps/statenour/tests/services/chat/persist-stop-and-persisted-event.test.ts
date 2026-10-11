/**
 * persistAssistantMessage · operator-stop state + persisted-event hand-off
 * (audit 04-F6, 04-F2, 2026-10-10). Drives the REAL function.
 *
 *   · a turn the operator stopped (stop row for THIS traceId) persists as
 *     `aborted`; any other turn keeps its finish-reason state;
 *   · the moment the row exists, the SSE stream for this trace is handed
 *     `{ id, content }` with the STORED text (banners included);
 *   · a row that was not written (P2002 duplicate) is never announced.
 *
 * The parent-row choice (latest user row) is deliberately untouched:
 * audit 04-F13 was refuted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  stopRequested: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { findFirst: (a: unknown) => h.findFirst(a), create: (a: unknown) => h.create(a) },
    chatConversation: { update: () => Promise.resolve({}) },
    brainMemory: { create: () => Promise.resolve({}) },
  },
}));
vi.mock("@/lib/services/chat/active-stream", () => ({
  isStreamStopRequested: (c: string, t: string) => h.stopRequested(c, t),
}));
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
  withErrorCapture: (_s: string, fn: () => unknown) => fn(),
  recordError: vi.fn(),
}));

import { persistAssistantMessage } from "@/lib/services/chat/persist-assistant-message";

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

beforeEach(() => {
  vi.clearAllMocks();
  h.findFirst.mockResolvedValue(null);
  h.create.mockResolvedValue({ id: "msg-1" });
  h.stopRequested.mockResolvedValue(false);
});

const createdState = () =>
  (h.create.mock.calls[0]![0] as { data: { streamingState: string } }).data.streamingState;

describe("operator stop", () => {
  it("a turn the operator stopped persists as aborted, and the lookup is keyed to THIS turn", async () => {
    h.stopRequested.mockResolvedValue(true);
    await persistAssistantMessage(args());
    expect(h.stopRequested).toHaveBeenCalledWith("conv-1", "T1");
    expect(createdState()).toBe("aborted");
  });

  it("CONTROL: an unstopped turn keeps its finish-reason state", async () => {
    await persistAssistantMessage(args());
    expect(createdState()).toBe("complete");
  });
});

describe("message.persisted hand-off", () => {
  it("hands the stream the stored row id and stored text", async () => {
    const out = await persistAssistantMessage(args());
    expect(out).toMatchObject({ kind: "done", createdAssistantId: "msg-1" });
    expect(h.notify).toHaveBeenCalledWith("T1", {
      id: "msg-1",
      content: (h.create.mock.calls[0]![0] as { data: { content: string } }).data.content,
    });
  });

  it("a row that was NOT written (P2002 duplicate) is never announced", async () => {
    h.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await persistAssistantMessage(args());
    expect(h.notify).not.toHaveBeenCalled();
  });
});
