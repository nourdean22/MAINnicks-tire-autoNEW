/**
 * tests/services/deferred-ctx-action-permission.test.ts · 2026-10-10 (Task 4 relay, audit 07-SN-03)
 *
 * The deferred post-turn work skips action blocks on a Read turn
 * (deferred-background-work.ts), but an OUTBOX REPLAY runs outside the chat
 * turn, where currentTurn() is null. So the permission must ride in the
 * persisted ctx itself. Drives the real buildOnFinish inside a turn scope and
 * reads the ctx handed to the outbox and to the deferred worker.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  enqueued: [] as Array<Record<string, unknown>>,
  ran: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => {
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
  withErrorCapture: (_l: string, fn: () => unknown) => {
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
vi.mock("@/lib/services/chat/post-turn-outbox", () => ({
  enqueuePostTurnWork: vi.fn(async (ctx: Record<string, unknown>) => {
    h.enqueued.push(ctx);
    return "outbox-1";
  }),
  completePostTurnWork: vi.fn(async () => undefined),
}));
vi.mock("@/lib/services/chat/deferred-background-work", () => ({
  runDeferredBackgroundWork: vi.fn(async (ctx: Record<string, unknown>) => {
    h.ran.push(ctx);
  }),
}));

import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";
import { withTurnContext } from "@/lib/agent/turn-context";

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
    userContent: "add milk to the list",
    turnSignal: { temperature: 0.5 },
    contextBlocksFired: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    startedAt: Date.now(),
    firstTokenRef: { current: null },
    traceId: "t_perm",
    recordTrace: vi.fn(),
    messages: [],
    topicTier: null,
    modeOverride: null,
  }) as never;

async function finish(actionPermission: "read" | "draft" | "execute") {
  await withTurnContext({ actionPermission }, async () => {
    const onFinish = buildOnFinish(deps());
    await onFinish({
      text: "Added milk to your list.",
      finishReason: "stop",
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    } as never);
  });
  await vi.waitFor(() => expect(h.enqueued.length).toBeGreaterThan(0), { timeout: 15_000 });
}

beforeEach(() => {
  h.enqueued.length = 0;
  h.ran.length = 0;
});

describe("deferred post-turn ctx carries the turn's action permission", () => {
  it("a Read turn persists actionPermission 'read' into the outbox ctx and the worker ctx", async () => {
    await finish("read");
    expect(h.enqueued[0]?.actionPermission).toBe("read");
    await vi.waitFor(() => expect(h.ran.length).toBeGreaterThan(0));
    expect(h.ran[0]?.actionPermission).toBe("read");
  }, 30_000);

  it("CONTROL · an Execute turn persists 'execute' (the value is the turn's, not a constant)", async () => {
    await finish("execute");
    expect(h.enqueued[0]?.actionPermission).toBe("execute");
  }, 30_000);
});
