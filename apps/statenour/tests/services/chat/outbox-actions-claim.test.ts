/**
 * tests/services/chat/outbox-actions-claim.test.ts · 2026-10-10
 * (audit 04-F12, 08-F2)
 *
 * THE DEFECT, two halves of one shape:
 *   F12 · the post-turn outbox REPLAYS runDeferredBackgroundWork after a crash
 *         or a lost done-mark, and the action-block phase ran executeActions
 *         BEFORE it looked for its traceId marker (the marker was checked only
 *         when posting the receipts message). A replay re-ran task.create,
 *         memory.remember, telegram.send.
 *   F2  · the actions phase was NOT awaited, so the outbox row was marked done
 *         while executeActions was still in flight; a deploy mid-execution left
 *         actions half-run with the outbox saying done.
 *
 * Pinned (claim-before-act): the action blocks of one turn are claimed in
 * action_attempts BEFORE they run; a replay of the same turn is a no-op for the
 * actions phase; the outbox row is marked done only after the actions phase
 * settles (its 15 s budget kept); the claim settles on the actions' real
 * outcome (still EXECUTING past the budget; a throw is UNKNOWN, never FAILED),
 * so a replay never re-runs it blindly. Controls: a different turn
 * still runs; an unreachable claim store still runs the actions (and says so).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, unknown> & { id: string; operationKey: string; state: string; attemptNo: number; holdUntil: Date | null };

const db = vi.hoisted(() => {
  const calls: Array<{ op: string; args: any }> = [];
  const handlers: Record<string, (args: any) => unknown> = {};
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method) => {
          if (typeof method !== "string" || method === "then") return undefined;
          return (args: unknown) => {
            const op = `${name}.${method}`;
            calls.push({ op, args });
            const h = handlers[op];
            return new Promise((resolve) => resolve(h ? h(args) : null));
          };
        },
      },
    );
  const prisma = new Proxy({}, { get: (_t, name) => (typeof name === "string" && name !== "then" ? model(name) : undefined) });
  return { calls, handlers, prisma, attempts: new Map<string, any>() };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

const agent = vi.hoisted(() => ({ executeActions: (() => undefined) as any }));
vi.mock("@/lib/ai/nick-agent", () => ({
  parseActions: (text: string) => (text.includes("```action") ? [{ type: "task.create", params: { title: "Call Bob" } }] : []),
  executeActions: (...a: unknown[]) => agent.executeActions(...a),
}));
vi.mock("@/lib/ai/memory", () => ({ recordInteraction: async () => undefined }));
vi.mock("@/lib/brain/pipeline-controller", () => ({ processConversation: async () => undefined }));
vi.mock("@/lib/brain/conversation-memory", () => ({ summarizeAndStoreConversation: async () => undefined }));
vi.mock("@/lib/chat/auto-rename", () => ({ maybeAutoRename: async () => undefined }));
vi.mock("@/lib/services/metrics", () => ({ metricRecordedForTrace: async () => true, recordMetricStrict: async () => ({}) }));
vi.mock("@/lib/ai/receipts/action-done-shadow-recorder", () => ({
  ACTION_DONE_SHADOW_METRIC: "action_done_shadow",
  recordActionDoneShadow: async () => "skipped",
}));
vi.mock("@/lib/ai/chat/recommendation-novelty-shadow", () => ({
  RECOMMENDATION_NOVELTY_METRIC: "recommendation_novelty",
  recordRecommendationNoveltyShadow: async () => undefined,
}));
vi.mock("@/lib/services/chat/prior-recommendations", () => ({ loadPriorRecommendations: async () => [] }));
vi.mock("@/lib/ai/content-feedback", () => ({ detectContentFeedback: () => null, persistContentFeedback: async () => undefined }));
vi.mock("@/lib/personal/friction-tracker", () => ({ detectFriction: () => null, persistFriction: async () => undefined }));
vi.mock("@/lib/ai/suggestion-cache", () => ({ warmSuggestionCache: () => undefined, heuristicSuggestions: () => [] }));
const logError = vi.hoisted(() => ({ fn: (..._a: unknown[]) => undefined }));
vi.mock("@/lib/utils/error-log", () => ({ logError: (...a: unknown[]) => logError.fn(...a) }));

import { runDeferredBackgroundWork } from "@/lib/services/chat/deferred-background-work";
import { completePostTurnWork } from "@/lib/services/chat/post-turn-outbox";

const ACTION_TEXT = 'On it.\n```action\n{"type":"task.create","params":{"title":"Call Bob"}}\n```';
const ctx = (over: Record<string, unknown> = {}) =>
  ({
    log: { info: vi.fn(), warn: vi.fn() },
    convId: "c1",
    traceId: "t1",
    provider: "openai",
    modelId: "m",
    mode: "standard",
    personality: "x",
    topicTier: "t",
    startedAt: Date.now(),
    userContent: "ok do it",
    cleanedText: "On it.",
    text: ACTION_TEXT,
    messages: [],
    createdAssistantId: "a1",
    ...over,
  }) as unknown as Parameters<typeof runDeferredBackgroundWork>[0];

const attemptFor = (traceId: string): Row | undefined =>
  [...db.attempts.values()].find((r: Row) => r.operationKey.includes(traceId));
const outboxDoneMarks = () =>
  db.calls.filter((c) => c.op === "postTurnOutbox.update" && c.args?.data?.status === "done");

function installAttemptStore() {
  db.attempts.clear();
  db.handlers["actionAttempt.create"] = ({ data }: { data: Row }) => {
    if (db.attempts.has(data.operationKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const row = { ...data, id: `att_${db.attempts.size + 1}` };
    db.attempts.set(data.operationKey, row);
    return { id: row.id, attemptNo: row.attemptNo };
  };
  const find = (where: { id?: string; operationKey?: string }) =>
    [...db.attempts.values()].find((r: Row) => (where.id ? r.id === where.id : r.operationKey === where.operationKey)) ?? null;
  db.handlers["actionAttempt.findUnique"] = ({ where }: { where: { id?: string; operationKey?: string } }) => find(where);
  db.handlers["actionAttempt.update"] = ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = find(where);
    if (row) Object.assign(row, data);
    return row;
  };
  db.handlers["actionAttempt.updateMany"] = () => ({ count: 0 });
}

beforeEach(() => {
  db.calls.length = 0;
  for (const k of Object.keys(db.handlers)) delete db.handlers[k];
  installAttemptStore();
  db.handlers["chatMessage.create"] = () => ({ id: "receipt_msg" });
  db.handlers["auditEvent.create"] = () => ({ id: "ae" });
  agent.executeActions = vi.fn(async () => [{ action: "task.create", success: true, result: { id: "task_1" } }]);
  logError.fn = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("action blocks are claimed before they run", () => {
  it("the same turn replayed twice runs executeActions ONCE; the replay says why it skipped", async () => {
    await runDeferredBackgroundWork(ctx());
    const replay = ctx();
    await runDeferredBackgroundWork(replay);
    expect(agent.executeActions).toHaveBeenCalledTimes(1);
    expect(replay.log.info).toHaveBeenCalledWith(
      "nick_agent_actions_replay_skipped",
      expect.objectContaining({ traceId: "t1" }),
    );
  });

  it("the claim row exists BEFORE executeActions starts, keyed by the trace", async () => {
    let seenAtExecution: string | undefined;
    agent.executeActions = vi.fn(async () => {
      seenAtExecution = attemptFor("t1")?.state;
      return [{ action: "task.create", success: true }];
    });
    await runDeferredBackgroundWork(ctx());
    expect(seenAtExecution).toBe("EXECUTING");
    // ...and it is settled once the phase returns: the provider-side truth is
    // unknown to us, so SUCCEEDED_UNVERIFIED, never VERIFIED.
    expect(attemptFor("t1")?.state).toBe("SUCCEEDED_UNVERIFIED");
  });

  it("positive control: a different turn is not blocked by this turn's claim", async () => {
    await runDeferredBackgroundWork(ctx());
    await runDeferredBackgroundWork(ctx({ traceId: "t2" }));
    expect(agent.executeActions).toHaveBeenCalledTimes(2);
  });

  it("an unreachable claim store still runs the actions once, and says so loudly", async () => {
    db.handlers["actionAttempt.create"] = () => {
      throw new Error("db down");
    };
    await runDeferredBackgroundWork(ctx());
    expect(agent.executeActions).toHaveBeenCalledTimes(1);
    expect(logError.fn).toHaveBeenCalledWith("chat.action-blocks", expect.any(Error), expect.objectContaining({ stage: "claim", traceId: "t1" }), "error");
  });
});

describe("the outbox row is marked done only after the actions phase", () => {
  it("a hung executeActions keeps the row open until its 15 s budget; the claim stays EXECUTING (still in flight) and a replay does not re-run it", async () => {
    // Warm the dynamic imports first so fake time only covers the phase itself.
    await runDeferredBackgroundWork(ctx({ traceId: "warm" }));
    db.calls.length = 0;
    agent.executeActions = vi.fn(() => new Promise(() => undefined));

    vi.useFakeTimers();
    let finished = false;
    // persist-assistant-turn.ts: run the deferred work, THEN mark the outbox row.
    const turn = runDeferredBackgroundWork(ctx())
      .then(() => completePostTurnWork("outbox_1"))
      .then(() => {
        finished = true;
      });
    await vi.waitFor(() => expect(agent.executeActions).toHaveBeenCalledTimes(1), { interval: 1 });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(finished).toBe(false);
    expect(outboxDoneMarks()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(6_000);
    await turn;
    expect(outboxDoneMarks()).toHaveLength(1);
    // 2026-10-10 hostile review: the budget ending says nothing about the
    // actions; they are still running. UNKNOWN here used to be permanent even
    // when they returned a moment later.
    expect(attemptFor("t1")?.state).toBe("EXECUTING");

    // The drain replays the same payload (e.g. the done-mark was lost).
    vi.useRealTimers();
    await runDeferredBackgroundWork(ctx());
    expect(agent.executeActions).toHaveBeenCalledTimes(1);
  });
});

describe("the claim settles on the actions' real outcome, however late", () => {
  it("actions that return after the 15 s budget settle SUCCEEDED_UNVERIFIED when they return", async () => {
    await runDeferredBackgroundWork(ctx({ traceId: "warm" }));
    let finish!: (v: unknown) => void;
    agent.executeActions = vi.fn(() => new Promise((r) => (finish = r)));

    vi.useFakeTimers();
    const turn = runDeferredBackgroundWork(ctx({ traceId: "late" }));
    await vi.waitFor(() => expect(agent.executeActions).toHaveBeenCalledTimes(1), { interval: 1 });
    await vi.advanceTimersByTimeAsync(16_000);
    await turn;
    expect(attemptFor("late")?.state).toBe("EXECUTING");

    finish([{ action: "task.create", success: true }]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(attemptFor("late")?.state).toBe("SUCCEEDED_UNVERIFIED"), { interval: 1 });
  });

  it("actions that throw settle UNKNOWN (they may have partly landed), never FAILED, and are not re-run", async () => {
    agent.executeActions = vi.fn(async () => {
      throw new Error("executeActions blew up after the first action");
    });

    await runDeferredBackgroundWork(ctx({ traceId: "boom" }));
    expect(attemptFor("boom")?.state).toBe("UNKNOWN");

    await runDeferredBackgroundWork(ctx({ traceId: "boom" }));
    expect(agent.executeActions).toHaveBeenCalledTimes(1);
  });
});
