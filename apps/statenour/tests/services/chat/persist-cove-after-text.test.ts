/**
 * B2 (job 2026-11-01-chat-humanizer-w6): the reply finishes when its text does.
 *
 * Measured 2026-11-01 (docs/research/chat-upgrades-2026-11-01.md section 2.2): the tail after the
 * last token was p50 15.9 s, p90 43 s, and Chain-of-Verification inside it p50 9.9 s. The stream
 * stayed open (Stop button, "Checking the reply...") until message.persisted, which waited for CoVe.
 *
 * Now a reply that claims no action is stored and announced on its draft, with `verifying: true`;
 * CoVe runs after, patches the row when it revises and marks tokenUsage.cove settled either way,
 * so the open chat can re-read it. A reply that claims an action keeps today's blocking path.
 * Harness copied from persist-cove-done.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  verify: vi.fn(),
  events: [] as string[],
  notified: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ where: { id: string }; data: Record<string, any> }>,
  /** What the stations before the row write turn the text into (null: unchanged). */
  storedText: null as string | null,
  deferredText: undefined as string | undefined,
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
              create: () => Promise.resolve({ id: "m-1" }),
              findUnique: () => Promise.resolve({ tokenUsage: { traceId: "t_cove" } }),
              update: (args: { where: { id: string }; data: Record<string, any> }) => {
                h.updates.push(args);
                return Promise.resolve({ id: args.where.id });
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
  verifyAndRevise: (draft: string, q: string, opts?: unknown) => h.verify(draft, q, opts),
}));
vi.mock("@/lib/services/chat/post-persist-verification", () => ({
  runPostPersistVerification: async (a: { cleanedText: string }) => ({ cleanedText: h.storedText ?? a.cleanedText }),
}));
vi.mock("@/lib/services/chat/post-turn-outbox", () => ({
  enqueuePostTurnWork: async () => "outbox-1",
  completePostTurnWork: async () => undefined,
}));
vi.mock("@/lib/services/chat/deferred-background-work", () => ({
  runDeferredBackgroundWork: async (ctx: { cleanedText?: string }) => {
    h.events.push("deferred-work");
    h.deferredText = ctx.cleanedText;
  },
}));
vi.mock("@/lib/ai/runtime/sse-stream", () => ({
  notifyMessagePersisted: (_trace: string, p: Record<string, unknown>) => {
    h.events.push("persisted");
    h.notified.push(p);
    return true;
  },
}));

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
const REVISED = "There are 12 open estimates this week, 9 of them older than three days and still waiting.";
const ACTION_REPLY = "I've added a task to call back about the 14 open estimates this week, so none of them slip.";

/** A CoVe call that resolves only when the test says so. */
function pendingCove() {
  let resolve!: (v: { revised: string; changed: boolean; questions: string[] }) => void;
  h.verify.mockImplementation(() => {
    h.events.push("cove-start");
    return new Promise((r) => (resolve = (v) => { h.events.push("cove-end"); r(v); }));
  });
  return (v: { revised: string; changed: boolean }) => resolve({ ...v, questions: ["q"] });
}
const tick = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  h.verify.mockReset();
  h.events.length = 0;
  h.notified.length = 0;
  h.updates.length = 0;
  h.storedText = null;
  h.deferredText = undefined;
  vi.restoreAllMocks();
});

describe("B2 · a reply with no action claim is announced before CoVe finishes", () => {
  it("message.persisted goes out on the draft, flagged verifying, while CoVe is still running", async () => {
    const finish = pendingCove();
    const done = buildOnFinish(deps())({ text: REPLY, finishReason: "stop" } as never);
    await vi.waitFor(() => expect(h.events).toContain("cove-start"), { timeout: 15_000, interval: 20 });

    expect(h.events).toEqual(["persisted", "cove-start"]);
    expect(h.notified[0]).toMatchObject({ id: "m-1", content: REPLY, verifying: true });

    finish({ revised: REVISED, changed: true });
    await done;
  }, 30_000);

  it("a revision patches the stored row and marks the check settled, keeping tokenUsage", async () => {
    const finish = pendingCove();
    const done = buildOnFinish(deps())({ text: REPLY, finishReason: "stop" } as never);
    await vi.waitFor(() => expect(h.events).toContain("cove-start"), { timeout: 15_000, interval: 20 });
    finish({ revised: REVISED, changed: true });
    await done;

    const patch = h.updates.find((u) => u.where.id === "m-1" && u.data.tokenUsage?.cove);
    expect(patch?.data.content).toBe(REVISED);
    expect(patch?.data.tokenUsage).toMatchObject({ traceId: "t_cove", cove: { status: "done", changed: true } });
    expect(h.deferredText, "memory and the rest of the turn read the checked text").toBe(REVISED);
  }, 30_000);

  it("an unchanged check still marks the row settled and leaves the text alone", async () => {
    const finish = pendingCove();
    const done = buildOnFinish(deps())({ text: REPLY, finishReason: "stop" } as never);
    await vi.waitFor(() => expect(h.events).toContain("cove-start"), { timeout: 15_000, interval: 20 });
    finish({ revised: REPLY, changed: false });
    await done;

    const patch = h.updates.find((u) => u.where.id === "m-1" && u.data.tokenUsage?.cove);
    expect(patch?.data.content).toBeUndefined();
    expect(patch?.data.tokenUsage).toMatchObject({ cove: { status: "done", changed: false } });
  }, 30_000);
});

describe("B2 · a failing deferred check never costs the turn its deferred work", () => {
  it("CoVe throwing after the announcement still runs the deferred work", async () => {
    h.verify.mockImplementation(async () => {
      h.events.push("cove-start");
      throw new Error("boom");
    });
    await buildOnFinish(deps())({ text: REPLY, finishReason: "stop" } as never);
    expect(h.events).toEqual(["persisted", "cove-start", "deferred-work"]);
  }, 30_000);
});

describe("B2 · a reply that claims an action still waits for CoVe", () => {
  it("CoVe settles before message.persisted, with a time bound, and nothing is flagged verifying", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const finish = pendingCove();
    const done = buildOnFinish(deps())({ text: ACTION_REPLY, finishReason: "stop" } as never);
    await vi.waitFor(() => expect(h.events).toContain("cove-start"), { timeout: 15_000, interval: 20 });
    await tick();
    expect(h.events).toEqual(["cove-start"]); // POSITIVE CONTROL for the test above: here persisted has to wait

    finish({ revised: ACTION_REPLY, changed: false });
    await done;
    expect(h.events).toEqual(["cove-start", "cove-end", "persisted", "deferred-work"]);
    expect(h.notified[0].verifying).toBeUndefined();
    const { COVE_BLOCKING_TIMEOUT_MS } = await import("@/lib/services/chat/persist-assistant-turn");
    expect(timeout).toHaveBeenCalledWith(COVE_BLOCKING_TIMEOUT_MS);
    expect(COVE_BLOCKING_TIMEOUT_MS).toBe(20_000);
    expect((h.verify.mock.calls[0][2] as { signal?: AbortSignal })?.signal).toBeInstanceOf(AbortSignal);
  }, 30_000);
});

describe("B2 · a check after the row write never undoes the stations before it", () => {
  it("text a station rewrote before the write (banner, notice) is not checked again, and says why", async () => {
    h.storedText = `${REPLY}\n\nThis forecast has no likelihood band.`;
    h.verify.mockResolvedValue({ revised: REVISED, changed: true, questions: ["q"] });
    await buildOnFinish(deps())({ text: REPLY, finishReason: "stop" } as never);
    expect(h.verify).not.toHaveBeenCalled();
    const patch = h.updates.find((u) => u.data.tokenUsage?.cove);
    expect(patch?.data.content).toBeUndefined();
    expect(patch?.data.tokenUsage.cove).toMatchObject({ status: "done", changed: false, skipped: "rewritten_before_store" });
  }, 30_000);

  it("a revision that adds an action claim L2 never saw is dropped, and the draft stays", async () => {
    h.verify.mockResolvedValue({ revised: `${REVISED} I've added a task to follow up on them.`, changed: true, questions: ["q"] });
    await buildOnFinish(deps())({ text: REPLY, finishReason: "stop" } as never);
    const patch = h.updates.find((u) => u.data.tokenUsage?.cove);
    expect(patch?.data.content).toBeUndefined();
    expect(patch?.data.tokenUsage.cove).toMatchObject({ changed: false, dropped: "adds_unchecked_claim" });
    expect(h.deferredText).toBe(REPLY);
  }, 30_000);

  it("the deferred check is time-bounded too", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    h.verify.mockResolvedValue({ revised: REPLY, changed: false, questions: [] });
    await buildOnFinish(deps())({ text: REPLY, finishReason: "stop" } as never);
    const { DEFERRED_COVE_TIMEOUT_MS } = await import("@/lib/services/chat/deferred-cove");
    expect(timeout).toHaveBeenCalledWith(DEFERRED_COVE_TIMEOUT_MS);
  }, 30_000);
});
