/**
 * Private Lab cost row (audit 07-X2, ruling R3, 2026-10-10).
 *
 * A private turn persists nothing, so its model spend never reached
 * ai_generations, the table the daily budget cap sums. The turn now writes
 * exactly ONE content-free cost row: feature, model, provider, token counts,
 * duration. No conversation id, no user text, no reply text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock("@/lib/ai/track", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/track")>()),
  trackGeneration: (a: unknown) => h.track(a),
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
vi.mock("@/lib/services/chat/post-turn-outbox", () => ({
  enqueuePostTurnWork: async () => "outbox-1",
  completePostTurnWork: async () => undefined,
}));
vi.mock("@/lib/services/chat/deferred-background-work", () => ({
  runDeferredBackgroundWork: async () => undefined,
}));
vi.mock("@/lib/ai/runtime/sse-stream", () => ({ notifyMessagePersisted: () => false }));

import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";

const USER_TEXT = "private question about the warehouse lease";
const REPLY_TEXT = "The lease ends in March; renewal terms are due by January.";
const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const deps = (privateMode: boolean) =>
  ({
    log: noopLog,
    privateMode,
    conversationId: privateMode ? undefined : "conv-1",
    convId: privateMode ? undefined : "conv-1",
    provider: "anthropic",
    modelId: "claude-sonnet-5",
    model: "m",
    mode: "standard",
    personality: "nick",
    contentMode: null,
    finalSystemPrompt: "sys",
    systemPrompt: "sys",
    finalTaskType: "reason",
    userContent: USER_TEXT,
    turnSignal: { temperature: 0.5, intent: "chat", outputShape: "prose" },
    contextBlocksFired: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    startedAt: Date.now() - 1500,
    firstTokenRef: { value: null },
    traceId: "t_private",
    recordTrace: vi.fn(),
    messages: [],
    topicTier: null,
    modeOverride: null,
    onWorkComplete: vi.fn(),
  }) as never;

const event = {
  text: REPLY_TEXT,
  finishReason: "stop",
  usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
} as never;

beforeEach(() => {
  h.track.mockReset().mockResolvedValue(undefined);
});

describe("Private Lab - one content-free cost row", () => {
  it("a private turn records its spend: feature chat, the turn's tokens, no conversation id", async () => {
    await buildOnFinish(deps(true))(event);
    expect(h.track).toHaveBeenCalledTimes(1);
    const row = h.track.mock.calls[0]![0] as Record<string, unknown>;
    expect(row).toMatchObject({
      feature: "chat",
      model: "claude-sonnet-5",
      provider: "anthropic",
      promptTokens: 1200,
      outputTokens: 300,
    });
    expect(typeof row.durationMs).toBe("number");
    expect(row.conversationId).toBeUndefined();
  });

  it("the cost row carries no user text and no reply text", async () => {
    await buildOnFinish(deps(true))(event);
    expect(h.track, "a row exists, so the absence below is a real check").toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(h.track.mock.calls);
    expect(serialized).not.toContain("warehouse");
    expect(serialized).not.toContain("renewal");
  });

  it("the private turn still resolves the stream's work-complete promise", async () => {
    const d = deps(true) as unknown as { onWorkComplete: ReturnType<typeof vi.fn> };
    await buildOnFinish(d as never)(event);
    expect(d.onWorkComplete).toHaveBeenCalledTimes(1);
  });

  it("CONTROL - a normal turn records exactly one row too, with its conversation id", async () => {
    await buildOnFinish(deps(false))(event);
    await vi.waitFor(() => expect(h.track).toHaveBeenCalled(), { timeout: 15_000 });
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.track.mock.calls[0]![0]).toMatchObject({ feature: "chat", promptTokens: 1200, conversationId: "conv-1" });
  }, 30_000);
});
