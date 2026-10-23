/**
 * The day's contradiction is spent on DELIVERY (Codex round 2, 2026-10-23).
 *
 * brain-context only RESERVES the day; the reservation becomes the "asked"
 * receipt (what the follow-up and NICK_DAILY_CONTRADICTION's kill criterion
 * read) here, after the assistant row is persisted. CONTROLS: no claim on the
 * turn, and a Private / transcript-off turn, promote nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mark: vi.fn() }));

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
vi.mock("@/lib/brain/contradiction-injector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/brain/contradiction-injector")>()),
  markContradictionAsked: (...args: unknown[]) => h.mark(...args),
}));

import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const CLAIM = { key: "claim-gap:2026-10-23", contradictionId: "open_1", kind: "daily" as const };
const deps = (extra: Record<string, unknown> = {}) =>
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
    userContent: "morning, what should I knock out first today",
    turnSignal: { temperature: 0.5, intent: "casual", outputShape: "prose" },
    contextBlocksFired: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    traceId: "t_contra",
    recordTrace: vi.fn(),
    messages: [],
    topicTier: null,
    modeOverride: null,
    ...extra,
  }) as never;

const REPLY = "Start with the brake job. One thing: the stretch log has one entry in two weeks. Is the record right, or is that outdated?";

beforeEach(() => {
  h.mark.mockReset().mockResolvedValue(true);
});

describe("buildOnFinish · the contradiction reservation becomes 'asked' after persist", () => {
  it("a persisted reply promotes the turn's claim with the row id and the stored text", async () => {
    await buildOnFinish(deps({ contradictionClaim: CLAIM }))({ text: REPLY, finishReason: "stop" } as never);
    expect(h.mark).toHaveBeenCalledTimes(1);
    expect(h.mark).toHaveBeenCalledWith(CLAIM, "m-1", expect.stringContaining("Is the record right"));
  }, 30_000);

  it("CONTROL · no claim on the turn promotes nothing", async () => {
    await buildOnFinish(deps())({ text: REPLY, finishReason: "stop" } as never);
    expect(h.mark).not.toHaveBeenCalled();
  }, 30_000);

  it("CONTROL · a transcript-off turn (nothing persisted) promotes nothing", async () => {
    await buildOnFinish(deps({ contradictionClaim: CLAIM, privateMode: true }))({ text: REPLY, finishReason: "stop" } as never);
    expect(h.mark).not.toHaveBeenCalled();
  }, 30_000);
});
