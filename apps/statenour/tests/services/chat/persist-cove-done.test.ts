/**
 * buildOnFinish - event.coveDone (audit 04-X11, consumer half, 2026-10-10).
 *
 * The buffered lanes (alternate-paths.ts, R3-04) run Chain-of-Verification
 * on the winner BEFORE it is displayed, so the bubble shows the verified
 * text. They then hand the persist pipeline `coveDone: true`; running CoVe
 * a second time here would pay for it twice and could store a text that
 * differs from the one on screen.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  verify: vi.fn(),
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
    userContent: "how many open estimates are there this week?",
    turnSignal: { temperature: 0.5, intent: "factual", outputShape: "prose" },
    contextBlocksFired: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    traceId: "t_cove",
    recordTrace: vi.fn(),
    messages: [],
    topicTier: null,
    modeOverride: null,
  }) as never;

const REPLY = "There are 14 open estimates this week, 9 of them older than three days and still waiting.";

beforeEach(() => {
  h.verify.mockReset().mockResolvedValue({ revised: REPLY, changed: false, questions: [] });
});

describe("buildOnFinish - coveDone", () => {
  it("a lane that already ran CoVe (coveDone: true) is not verified again", async () => {
    await buildOnFinish(deps())({ text: REPLY, finishReason: "stop", coveDone: true } as never);
    expect(h.verify).not.toHaveBeenCalled();
  }, 30_000);

  it("CONTROL - without coveDone a factual turn is verified once (the flag and intent do fire)", async () => {
    await buildOnFinish(deps())({ text: REPLY, finishReason: "stop" } as never);
    expect(h.verify).toHaveBeenCalledTimes(1);
  }, 30_000);
});

describe("FACTUAL_INTENTS - one definition, exported by chain-of-verification", () => {
  it("names the intents CoVe runs on", async () => {
    const { FACTUAL_INTENTS } = await import("@/lib/ai/chat/chain-of-verification");
    expect([...FACTUAL_INTENTS].sort()).toEqual(["analytical", "factual", "instructional", "procedural"]);
  });
});
