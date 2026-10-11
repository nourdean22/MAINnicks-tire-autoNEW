/**
 * persistAssistantMessage - the reply's parent is the turn's OWN user row
 * (audit 04-F13, ruling R1, 2026-10-10). Drives the REAL function over a
 * small in-memory chat_messages store.
 *
 * The parent used to be the NEWEST user row at finish time. Two overlapping
 * turns in one conversation (a slash command fired while streaming, the
 * history drawer's /receipts, a second device) attached reply 1 to user
 * message 2, and reply 2 then hit the duplicate guard and was dropped.
 *
 * The turn's user row is now found by its clientMessageId (unique per
 * conversation), falling back to the newest row when the id is absent or
 * unknown. The duplicate guard still keys on the parent, so a double-submit
 * of ONE message is still blocked (the control the old rule protected).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  conversationId: string;
  role: string;
  clientMessageId?: string | null;
  parentMessageId?: string | null;
  branchId?: string | null;
  tokenUsage?: Record<string, unknown> | null;
  createdAt: Date;
};

const h = vi.hoisted(() => ({ rows: [] as Row[], seq: 0 }));

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if ((row as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => {
  const chatMessage = {
    findFirst: async (a: { where: Record<string, unknown>; orderBy?: { createdAt?: string } }) => {
      const hits = h.rows.filter((r) => matches(r, a.where));
      if (a.orderBy?.createdAt === "desc") hits.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
      return hits[0] ? { id: hits[0].id, createdAt: hits[0].createdAt } : null;
    },
    create: async (a: { data: Row }) => {
      const d = a.data;
      // chat_messages_assistant_reply_uniq: one assistant reply per (parent, branch).
      if (
        d.role === "assistant" &&
        d.parentMessageId &&
        h.rows.some((r) => r.role === "assistant" && r.parentMessageId === d.parentMessageId && r.branchId === d.branchId)
      ) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      const row = { ...d, id: `A${++h.seq}`, createdAt: new Date() };
      h.rows.push(row);
      return { id: row.id };
    },
  };
  const passthrough = {
    create: async () => ({ id: "x" }),
    update: async () => ({ id: "x" }),
    upsert: async () => ({ id: "x" }),
    findFirst: async () => null,
    findUnique: async () => null,
    findMany: async () => [],
    count: async () => 0,
    updateMany: async () => ({ count: 0 }),
    groupBy: async () => [],
  };
  const prisma: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "chatMessage") return chatMessage;
        if (prop === "$transaction") return async (fn: (tx: unknown) => unknown) => fn(prisma);
        if (prop === "$queryRaw" || prop === "$executeRaw") return async () => [];
        return passthrough;
      },
    },
  );
  return { prisma };
});
vi.mock("@/lib/logger", () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { logger: { withSurface: () => noop, ...noop } };
});
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

import { persistAssistantMessage } from "@/lib/services/chat/persist-assistant-message";
import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";

const log = { info: vi.fn(), warn: vi.fn() };

function args(userClientMessageId: string | undefined, traceId: string) {
  return {
    hasContent: true,
    hasToolCalls: false,
    cleanedText: `reply for ${userClientMessageId ?? "unknown"}`,
    reasoningText: "",
    finishReason: "stop",
    usage: undefined,
    convId: "conv-1",
    traceId,
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
    turnSignal: { complexity: "simple", intent: "chat", outputShape: "prose", urgency: "normal", temperature: 0.5, useChainOfThought: false },
    contextBlocksFired: {},
    deeperContextCount: 0,
    deeperContextTypes: [],
    personality: "nick",
    userContent: "q",
    posture: undefined,
    log,
    userClientMessageId,
  } as unknown as Parameters<typeof persistAssistantMessage>[0];
}

const assistantParents = () => h.rows.filter((r) => r.role === "assistant").map((r) => r.parentMessageId);

beforeEach(() => {
  h.seq = 0;
  h.rows.length = 0;
  // U1 was sent first; U2 (a slash command, a second device) landed while
  // reply 1 was still streaming.
  h.rows.push(
    { id: "U1", conversationId: "conv-1", role: "user", clientMessageId: "c1", createdAt: new Date(1_000) },
    { id: "U2", conversationId: "conv-1", role: "user", clientMessageId: "c2", createdAt: new Date(2_000) },
  );
});

describe("overlapping turns keep their own parent", () => {
  it("reply 1 finishing after user message 2 still attaches to user message 1", async () => {
    const out = await persistAssistantMessage(args("c1", "T1"));
    expect(out.kind).toBe("done");
    expect(assistantParents()).toEqual(["U1"]);
  });

  it("reply 2 is then stored too (not dropped as a duplicate of reply 1)", async () => {
    await persistAssistantMessage(args("c1", "T1"));
    const out = await persistAssistantMessage(args("c2", "T2"));
    expect(out.kind).toBe("done");
    expect(assistantParents()).toEqual(["U1", "U2"]);
  });
});

describe("buildOnFinish threads the turn's clientMessageId to persist", () => {
  const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const deps = (userClientMessageId: string | undefined) =>
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
      userContent: "q",
      userClientMessageId,
      turnSignal: { temperature: 0.5, intent: "chat", outputShape: "prose" },
      contextBlocksFired: [],
      deeperContextCount: 0,
      deeperContextTypes: [],
      startedAt: Date.now(),
      firstTokenRef: { value: null },
      traceId: "T-bof",
      recordTrace: vi.fn(),
      messages: [],
      topicTier: null,
      modeOverride: null,
    }) as never;

  it("deps.userClientMessageId 'c1' parents the reply on U1", async () => {
    await buildOnFinish(deps("c1"))({ text: "reply one", finishReason: "stop" } as never);
    expect(assistantParents()).toEqual(["U1"]);
  }, 30_000);

  it("CONTROL - without it the reply parents on the newest row, U2", async () => {
    await buildOnFinish(deps(undefined))({ text: "reply one", finishReason: "stop" } as never);
    expect(assistantParents()).toEqual(["U2"]);
  }, 30_000);
});

describe("receipts are always an array on a persisted reply", () => {
  // The Retry gate (turnHasSideEffect) refuses a reloaded unfinished turn with NO receipts
  // array, because then nothing records what ran. A reply that ran no tool must say so with [].
  it("a text-only reply stores toolReceipts [] so a reload can tell 'nothing ran' from 'unknown'", async () => {
    await persistAssistantMessage(args("c1", "T1"));
    const reply = h.rows.find((r) => r.role === "assistant");
    expect(reply?.tokenUsage?.toolReceipts).toEqual([]);
  });
});

describe("controls", () => {
  it("no clientMessageId: the newest user row is the parent (the old path)", async () => {
    await persistAssistantMessage(args(undefined, "T1"));
    expect(assistantParents()).toEqual(["U2"]);
  });

  it("an unknown clientMessageId falls back to the newest user row", async () => {
    await persistAssistantMessage(args("never-stored", "T1"));
    expect(assistantParents()).toEqual(["U2"]);
  });

  it("a double-submit of ONE message is still blocked: the second reply is a duplicate-skip", async () => {
    await persistAssistantMessage(args("c1", "T1"));
    const second = await persistAssistantMessage(args("c1", "T1b"));
    expect(second.kind).toBe("duplicate-skip");
    expect(assistantParents()).toEqual(["U1"]);
  });
});
