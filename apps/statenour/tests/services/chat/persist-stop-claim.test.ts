/**
 * Stop vs persist: one answer, one stored state (audit 04-H4 server half,
 * S8 parked residual, 2026-10-10).
 *
 * Persist used to READ the stop marker, then create the reply row. A Stop
 * whose marker write and row read both landed between those two steps
 * answered `stopped: true` over a row stored as `complete`.
 *
 * Persist now CLAIMS the stop slot: it creates the stop row's unique key
 * (brain_memories category+key) in the same transaction as the reply row.
 * A Stop that got there first makes the claim fail (P2002) and the reply is
 * stored `aborted`; a Stop that comes later waits on the claimed key and then
 * finds the stored row (`already_complete`).
 *
 * Drives the REAL persistAssistantMessage and the REAL requestStreamStop over
 * one in-memory store that models what the race depends on: unique keys, and
 * an upsert that waits on a key another open transaction has inserted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type BM = {
  category: string;
  key: string;
  source: string;
  expiresAt: Date | null;
  deletedAt: Date | null;
  metadata: unknown;
};
type Msg = Record<string, unknown> & { id: string; createdAt: Date };
type Tx = { bm: Map<string, BM>; msgs: Msg[]; settled: Promise<void>; settle: () => void };

const s = vi.hoisted(() => ({
  bm: new Map<string, unknown>(),
  msgs: [] as unknown[],
  open: new Set<unknown>(),
  seq: 0,
  hold: null as null | { called: () => void; release: Promise<void> },
  txFails: false,
  failGuardRead: false,
  assistantCreates: 0,
}));

vi.mock("@/lib/prisma", () => {
  const bmKey = (w: { category_key: { category: string; key: string } }) => `${w.category_key.category}|${w.category_key.key}`;
  const committedBm = () => s.bm as Map<string, BM>;
  const msgs = () => s.msgs as Msg[];
  const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
  const heldBy = (k: string, self: Tx | null) => [...(s.open as Set<Tx>)].find((t) => t !== self && t.bm.has(k));

  const matchMsg = (m: Msg, where: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (k === "tokenUsage") {
        const f = v as { path: string[]; equals: unknown };
        if ((m.tokenUsage as Record<string, unknown> | undefined)?.[f.path[0]!] !== f.equals) return false;
      } else if (k === "createdAt") {
        if (m.createdAt < (v as { gte: Date }).gte) return false;
      } else if (m[k] !== v) return false;
    }
    return true;
  };

  const client = (tx: Tx | null) => ({
    brainMemory: {
      findUnique: async (a: { where: { category_key: { category: string; key: string } } }) =>
        committedBm().get(bmKey(a.where)) ?? null,
      create: async (a: { data: BM }) => {
        const k = `${a.data.category}|${a.data.key}`;
        if (committedBm().has(k) || heldBy(k, tx) || tx?.bm.has(k)) throw p2002();
        const row = { deletedAt: null, expiresAt: null, metadata: null, ...a.data };
        if (tx) tx.bm.set(k, row);
        else committedBm().set(k, row);
        return { id: k };
      },
      // INSERT ... ON CONFLICT DO UPDATE: waits on a key another open
      // transaction inserted, then updates the committed row or inserts.
      upsert: async (a: { where: { category_key: { category: string; key: string } }; create: BM; update: Partial<BM> }) => {
        const k = bmKey(a.where);
        for (let t = heldBy(k, tx); t; t = heldBy(k, tx)) await t.settled;
        const cur = committedBm().get(k);
        if (cur) Object.assign(cur, a.update);
        else committedBm().set(k, { deletedAt: null, expiresAt: null, metadata: null, ...a.create });
        return { id: k };
      },
    },
    chatMessage: {
      findFirst: async (a: { where: Record<string, unknown>; orderBy?: { createdAt?: string } }) => {
        if (s.failGuardRead && a.where.role === "assistant" && a.where.parentMessageId) throw new Error("read failed");
        const hits = msgs().filter((m) => matchMsg(m, a.where));
        if (a.orderBy?.createdAt === "desc") hits.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
        return hits[0] ?? null;
      },
      create: async (a: { data: Record<string, unknown> }) => {
        if (a.data.role === "assistant") s.assistantCreates += 1;
        if (a.data.role === "assistant" && s.hold) {
          const hold = s.hold;
          s.hold = null;
          hold.called();
          await hold.release;
        }
        const pool = [...msgs(), ...(tx?.msgs ?? [])];
        if (
          a.data.role === "assistant" &&
          a.data.parentMessageId &&
          pool.some((m) => m.role === "assistant" && m.parentMessageId === a.data.parentMessageId && m.branchId === a.data.branchId)
        ) {
          throw p2002();
        }
        const row = { ...a.data, id: `A${++s.seq}`, createdAt: new Date() } as Msg;
        if (tx) tx.msgs.push(row);
        else msgs().push(row);
        return { id: row.id };
      },
    },
    chatConversation: { update: async () => ({}) },
  });

  const prisma = {
    ...client(null),
    $transaction: async (fn: (txc: unknown) => Promise<unknown>) => {
      if (s.txFails) throw new Error("transaction could not start");
      let settle!: () => void;
      const tx: Tx = { bm: new Map(), msgs: [], settled: new Promise<void>((r) => (settle = r)), settle: () => settle() };
      (s.open as Set<Tx>).add(tx);
      try {
        const out = await fn(client(tx));
        for (const [k, v] of tx.bm) committedBm().set(k, v);
        msgs().push(...tx.msgs);
        return out;
      } finally {
        (s.open as Set<Tx>).delete(tx);
        tx.settle();
      }
    },
  };
  return { prisma };
});
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
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
import { requestStreamStop } from "@/lib/services/chat/active-stream";

const log = { info: vi.fn(), warn: vi.fn() };
const CONV = "conv-1";
const TRACE = "T1";

function args() {
  return {
    hasContent: true,
    hasToolCalls: false,
    cleanedText: "Here is the plan for the week.",
    reasoningText: "",
    finishReason: "stop",
    usage: undefined,
    convId: CONV,
    traceId: TRACE,
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
    userContent: "plan my week",
    posture: undefined,
    log,
  } as unknown as Parameters<typeof persistAssistantMessage>[0];
}

const reply = () => (s.msgs as Msg[]).find((m) => m.role === "assistant");
const ticks = () => new Promise((r) => setTimeout(r, 20));

function holdAssistantCreate() {
  let called!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((r) => (called = r));
  s.hold = { called, release: new Promise<void>((r) => (release = r)) };
  return { reached, release };
}

beforeEach(() => {
  s.bm.clear();
  s.msgs.length = 0;
  s.open.clear();
  s.seq = 0;
  s.hold = null;
  s.txFails = false;
  s.failGuardRead = false;
  s.assistantCreates = 0;
  log.warn.mockClear();
  // The turn is live: the active-stream record names this trace.
  s.bm.set(`active_chat_stream|stream:${CONV}`, {
    category: "active_chat_stream",
    key: `stream:${CONV}`,
    source: "chat-route",
    expiresAt: new Date(Date.now() + 600_000),
    deletedAt: null,
    metadata: { status: "active", traceId: TRACE, startedAt: new Date(Date.now() - 60_000).toISOString() },
  });
  (s.msgs as Msg[]).push({ id: "U1", conversationId: CONV, role: "user", createdAt: new Date(Date.now() - 30_000) });
});

describe("Stop racing persist", () => {
  it("a Stop landing between persist's decision and its row create never answers stopped over a complete row", async () => {
    const gate = holdAssistantCreate();
    const persisting = persistAssistantMessage(args());
    await gate.reached;
    const stopping = requestStreamStop(CONV);
    await ticks();
    gate.release();
    const [, stop] = await Promise.all([persisting, stopping]);
    const state = reply()?.streamingState;
    expect(state, "the reply row was stored").toBeDefined();
    if (stop.stopped) expect(state).toBe("aborted");
    else expect(stop).toEqual({ stopped: false, reason: "already_complete" });
  });

  it("a Stop before persist claims the slot: the reply is stored aborted and the Stop's answer holds", async () => {
    const stop = await requestStreamStop(CONV);
    expect(stop).toEqual({ stopped: true, traceId: TRACE });
    await persistAssistantMessage(args());
    expect(reply()?.streamingState).toBe("aborted");
  });

  it("CONTROL - no Stop: the reply is complete, and a later Stop answers already_complete", async () => {
    await persistAssistantMessage(args());
    expect(reply()?.streamingState).toBe("complete");
    expect(await requestStreamStop(CONV)).toEqual({ stopped: false, reason: "already_complete" });
  });

  it("the slot held by an earlier persist claim of this turn is not a Stop", async () => {
    s.bm.set(`active_chat_stream|stop:${CONV}:${TRACE}`, {
      category: "active_chat_stream",
      key: `stop:${CONV}:${TRACE}`,
      source: "chat-persist",
      expiresAt: new Date(Date.now() + 600_000),
      deletedAt: null,
      metadata: null,
    });
    await persistAssistantMessage(args());
    expect(reply()?.streamingState).toBe("complete");
  });

  it("a transaction that cannot run never costs the reply: it is stored as before, not stopped", async () => {
    s.txFails = true;
    const out = await persistAssistantMessage(args());
    expect(out).toMatchObject({ kind: "done" });
    expect(reply()?.streamingState).toBe("complete");
    expect((s.msgs as Msg[]).filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("a duplicate reply caught by the unique index (P2002 on the reply row) stays a quiet skip: one write attempt", async () => {
    // Another onFinish already replied to U1; the app-level guard's read
    // fails, so only the index (chat_messages_assistant_reply_uniq) catches it.
    (s.msgs as Msg[]).push({ id: "A0", conversationId: CONV, role: "assistant", parentMessageId: "U1", branchId: "U1", createdAt: new Date() });
    s.failGuardRead = true;
    const out = await persistAssistantMessage(args());
    expect(out).toMatchObject({ kind: "done", createdAssistantId: null });
    expect(s.assistantCreates, "the P2002 is not retried outside the transaction").toBe(1);
    expect((s.msgs as Msg[]).filter((m) => m.role === "assistant").map((m) => m.id)).toEqual(["A0"]);
  });
});
