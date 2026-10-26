/**
 * buildOnFinish - deps.postFlushRegen (consumer half, 2026-10-26, job 2026-10-26-chat-latency).
 *
 * The verified regen lane no longer buffers the reply before the stream; its
 * best-of-2 runs here, on the draft that already streamed. Pinned at the
 * CONSUMER end: the stored row carries the better draft, CoVe verifies that
 * final text, and a losing or absent second draft keeps the streamed text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  verify: vi.fn(),
  stored: [] as string[],
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
          if (prop === "chatMessage")
            return {
              ...passthrough,
              create: (a: { data?: { content?: string } }) => {
                h.stored.push(String(a?.data?.content ?? ""));
                return Promise.resolve({ id: "m-1" });
              },
            };
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
vi.mock("@/lib/feature-flags", () => ({
  getFlag: (name: string) => ({ isOn: name === "NICK_COVE" }),
}));
vi.mock("@/lib/ai/chat/chain-of-verification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chat/chain-of-verification")>()),
  verifyAndRevise: (draft: string, q: string) => h.verify(draft, q),
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
const deps = (postFlushRegen?: unknown) =>
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
    userContent: "how many open estimates are there this week?",
    turnSignal: { temperature: 0.5, intent: "factual", outputShape: "prose" },
    contextBlocksFired: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    traceId: "t_regen",
    recordTrace: vi.fn(),
    messages: [],
    topicTier: null,
    modeOverride: null,
    ...(postFlushRegen ? { postFlushRegen } : {}),
  }) as never;

const DRAFT = "It depends on various factors and there are many ways to look at it this week.";
const BETTER = "There are 14 open estimates this week, 9 of them older than three days and still waiting.";

beforeEach(() => {
  h.stored.length = 0;
  h.verify.mockReset().mockImplementation(async (draft: string) => ({ revised: draft, changed: false, questions: [] }));
});

describe("buildOnFinish - postFlushRegen", () => {
  it("a better second draft is what the row stores, and CoVe verifies that text", async () => {
    const regen = vi.fn(async () => ({ text: BETTER, steps: [], usage: { inputTokens: 10, outputTokens: 5 } }));
    await buildOnFinish(deps(regen))({ text: DRAFT, finishReason: "stop" } as never);
    expect(regen).toHaveBeenCalledWith({ draft: DRAFT });
    expect(h.stored).toContain(BETTER);
    expect(h.stored).not.toContain(DRAFT);
    expect(h.verify).toHaveBeenCalledWith(BETTER, expect.any(String));
  }, 30_000);

  it("CONTROL - a losing second draft keeps the streamed text", async () => {
    const regen = vi.fn(async () => ({ text: null, usage: { inputTokens: 10 } }));
    await buildOnFinish(deps(regen))({ text: DRAFT, finishReason: "stop" } as never);
    expect(regen).toHaveBeenCalledTimes(1);
    expect(h.stored).toContain(DRAFT);
  }, 30_000);

  it("CONTROL - a regen that throws keeps the streamed text and the row still saves", async () => {
    const regen = vi.fn(async () => {
      throw new Error("model down");
    });
    await buildOnFinish(deps(regen))({ text: DRAFT, finishReason: "stop" } as never);
    expect(h.stored).toContain(DRAFT);
  }, 30_000);
});
