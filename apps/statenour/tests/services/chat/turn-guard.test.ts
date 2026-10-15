/**
 * turn-guard - the decision a chat POST makes BEFORE any work (2026-10-15).
 *
 * Drives the REAL guardTurn over an in-memory chat_messages store; only the claim is stubbed (its
 * races are pinned in turn-claim.test.ts). The table under test:
 *
 *   claim held by a live run             -> refuse 409 turn_in_flight        (any trigger)
 *   no user row yet                      -> run                              (first send, incl. a replay of one that never landed)
 *   user row, no reply                   -> run                              (the earlier run died; answer it)
 *   user row + reply, submit-message     -> refuse 409 turn_answered         (a re-send is never a new run)
 *   user row + clean reply, regenerate   -> run                              (a deliberate regenerate starts fresh)
 *   user row + reply that may have run   -> refuse 409 turn_ran              (the client's own rule, now the server's)
 *   user row, replies unreadable         -> refuse 503 turn_unreadable       (an attempt exists; its outcome is unknown)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  clientMessageId?: string | null;
  parentMessageId?: string | null;
  content?: string;
  parts?: unknown;
  streamingState?: string;
  tokenUsage?: unknown;
  createdAt: Date;
};

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  failRead: undefined as undefined | "findFirst" | "findMany" | "assistantOnly",
  // The first user-row lookup misses, as if the row landed between it and the claim.
  hideUserRowOnce: false,
  claimResult: undefined as unknown,
  claimCalls: [] as unknown[],
  finished: 0,
  settled: 0,
}));
const rows = () => h.rows as Row[];

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as Record<string, unknown>[]).some((w) => matches(row, w));
    const actual = (row as unknown as Record<string, unknown>)[k] ?? null;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const o = v as { gt?: Date; gte?: Date; lt?: Date };
      const t = (actual as Date).getTime();
      return (o.gt === undefined || t > o.gt.getTime()) && (o.gte === undefined || t >= o.gte.getTime()) && (o.lt === undefined || t < o.lt.getTime());
    }
    return actual === v;
  });
}
const pick = (a: { where: Record<string, unknown>; orderBy?: { createdAt?: string } }) => {
  const hits = rows().filter((r) => matches(r, a.where));
  hits.sort((x, y) => (a.orderBy?.createdAt === "desc" ? -1 : 1) * (x.createdAt.getTime() - y.createdAt.getTime()));
  return hits;
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: {
      findFirst: async (a: { where: Record<string, unknown>; orderBy?: { createdAt?: string } }) => {
        if (h.failRead === "findFirst") throw new Error("neon: connection terminated");
        if (h.failRead === "assistantOnly" && a.where.role === "assistant") throw new Error("neon: connection terminated");
        if (h.hideUserRowOnce && a.where.role === "user" && a.where.clientMessageId !== undefined) {
          h.hideUserRowOnce = false;
          return null;
        }
        const hit = pick(a)[0];
        return hit ? { ...hit } : null;
      },
      findMany: async (a: { where: Record<string, unknown>; orderBy?: { createdAt?: string } }) => {
        if (h.failRead === "findMany" || h.failRead === "assistantOnly") throw new Error("neon: connection terminated");
        return pick(a).map((r) => ({ ...r }));
      },
    },
  },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/services/chat/turn-claim", () => ({
  claimTurn: vi.fn(async (input: unknown) => {
    h.claimCalls.push(input);
    return h.claimResult;
  }),
}));

import { guardTurn, type TurnGuardResult } from "@/lib/services/chat/turn-guard";

const claim = () => ({
  traceId: "T-new",
  setConversation: vi.fn(),
  settleWith: vi.fn(() => void (h.settled += 1)),
  finish: vi.fn(() => void (h.finished += 1)),
});
const claimed = () => ({ kind: "claimed" as const, claim: claim() });

const user = (id: string, clientMessageId: string | null, at: number, conversationId = "conv-1"): Row => ({
  id,
  conversationId,
  role: "user",
  clientMessageId,
  createdAt: new Date(at),
});
const reply = (id: string, at: number, tokenUsage: unknown, extra: Partial<Row> = {}): Row => ({
  id,
  conversationId: "conv-1",
  role: "assistant",
  content: "A reply",
  streamingState: "complete",
  tokenUsage,
  createdAt: new Date(at),
  ...extra,
});
const write = { toolName: "createTask", category: "task", sideEffecting: true, verifiable: true, status: "success" };
const readOnly = { toolName: "searchMemories", category: "memory", sideEffecting: false, verifiable: true, status: "success" };

const guard = (over: Partial<Parameters<typeof guardTurn>[0]> = {}) =>
  guardTurn({
    lastMessage: { id: "m-1", role: "user" },
    conversationId: "conv-1",
    trigger: "submit-message",
    traceId: "T-new",
    transcriptOff: false,
    ...over,
  });

async function refused(result: TurnGuardResult) {
  if (result.kind !== "refuse") throw new Error("expected a refusal, got run");
  const body = (await result.response.clone().json()) as Record<string, unknown>;
  return { status: result.response.status, headers: result.response.headers, body };
}

beforeEach(() => {
  h.rows = [];
  h.failRead = undefined;
  h.hideUserRowOnce = false;
  h.claimResult = claimed();
  h.claimCalls = [];
  h.finished = 0;
  h.settled = 0;
});

describe("what is never guarded", () => {
  it.each([
    ["Private Lab / ephemeral", { transcriptOff: true }],
    ["a last message that is not the operator's", { lastMessage: { id: "m-1", role: "assistant" } }],
    ["a message with no id the client minted", { lastMessage: { role: "user" } }],
    ["no message at all", { lastMessage: undefined }],
  ])("%s: runs with no claim and touches nothing", async (_n, over) => {
    const result = await guard(over as Partial<Parameters<typeof guardTurn>[0]>);
    expect(result).toEqual({ kind: "run", claim: null, conversationId: null });
    expect(h.claimCalls).toHaveLength(0);
  });
});

describe("a live run holds the message", () => {
  it.each(["submit-message", "regenerate-message", undefined])("%s: refused, and says which run and which thread", async (trigger) => {
    h.rows = [user("U1", "m-1", 1_000)];
    h.claimResult = { kind: "in_flight", traceId: "T-live", conversationId: "conv-1" };
    const r = await refused(await guard({ trigger }));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "turn_in_flight", traceId: "T-live", conversationId: "conv-1" });
    expect(r.headers.get("X-Trace-Id")).toBe("T-live");
    expect(r.headers.get("X-Conversation-Id")).toBe("conv-1");
    expect(r.body.error).toBe("Nick is still working on that message.");
  });

  it("a first-send replay (the client never learned the thread) is told the thread the live run created", async () => {
    h.claimResult = { kind: "in_flight", traceId: "T-live", conversationId: "conv-new" };
    const r = await refused(await guard({ conversationId: undefined }));
    expect(r.headers.get("X-Conversation-Id")).toBe("conv-new");
  });

  it("the claim is keyed by the ORIGINAL message id, even when a hydrated thread names it by database id", async () => {
    h.rows = [user("cuid-1", "uuid-1", 1_000)];
    h.claimResult = { kind: "in_flight", traceId: "T-live", conversationId: "conv-1" };
    await guard({ lastMessage: { id: "cuid-1", role: "user" } });
    expect(h.claimCalls[0]).toMatchObject({ clientMessageId: "uuid-1", traceId: "T-new", conversationId: "conv-1" });
  });
});

describe("nothing in flight: the saved rows decide", () => {
  it("a first send has no user row and runs, holding the claim", async () => {
    const result = await guard();
    expect(result).toMatchObject({ kind: "run", claim: expect.any(Object) });
    expect(h.finished).toBe(0);
    expect(h.claimCalls[0]).toMatchObject({ clientMessageId: "m-1", conversationId: "conv-1" });
  });

  it("a user row with no reply runs: the earlier run died and the message is still unanswered", async () => {
    h.rows = [user("U1", "m-1", 1_000)];
    for (const trigger of ["submit-message", "regenerate-message"]) {
      expect(await guard({ trigger })).toMatchObject({ kind: "run" });
    }
  });

  it("a first-send replay that runs is handed the thread the first attempt created, so it cannot open a second one", async () => {
    h.rows = [user("U1", "m-1", 1_000, "conv-first")];
    // The client never saw the thread id: it re-sends with none.
    expect(await guard({ conversationId: undefined, trigger: "regenerate-message" })).toMatchObject({ kind: "run", conversationId: "conv-first" });
  });

  it("a first send has no thread to hand on", async () => {
    expect(await guard({ conversationId: undefined })).toMatchObject({ kind: "run", conversationId: null });
  });

  it("a re-send of an answered message is refused, and the claim is let go", async () => {
    h.rows = [user("U1", "m-1", 1_000), reply("A1", 2_000, { traceId: "T-old", toolReceipts: [] }, { parentMessageId: "U1" })];
    const r = await refused(await guard({ trigger: "submit-message" }));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "turn_answered", traceId: "T-old", conversationId: "conv-1" });
    expect(r.headers.get("X-Trace-Id")).toBe("T-old");
    expect(h.finished).toBe(1);
  });

  it("a deliberate regenerate of a clean reply starts a fresh run", async () => {
    h.rows = [user("U1", "m-1", 1_000), reply("A1", 2_000, { traceId: "T-old", toolReceipts: [readOnly] }, { parentMessageId: "U1" })];
    expect(await guard({ trigger: "regenerate-message" })).toMatchObject({ kind: "run" });
    expect(h.finished).toBe(0);
  });

  it("a regenerate of a reply that wrote is refused with the client's own wording", async () => {
    h.rows = [user("U1", "m-1", 1_000), reply("A1", 2_000, { traceId: "T-old", toolReceipts: [write] }, { parentMessageId: "U1" })];
    const r = await refused(await guard({ trigger: "regenerate-message" }));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "turn_ran", traceId: "T-old" });
    expect(r.body.error).toBe("That reply may have run an action, so it can't be replayed.");
    expect(h.finished).toBe(1);
  });

  it("any reply of the turn that may have written blocks it, not just the newest one", async () => {
    h.rows = [
      user("U1", "m-1", 1_000),
      reply("stub", 1_500, { traceId: "T-1", toolReceipts: [write] }, { streamingState: "errored" }),
      reply("final", 2_000, { traceId: "T-2", toolReceipts: [] }, { parentMessageId: "U1" }),
    ];
    expect((await refused(await guard({ trigger: "regenerate-message" }))).body.code).toBe("turn_ran");
  });

  it("an errored stub the writer could not vouch for blocks a regenerate; a terminal clean one does not", async () => {
    h.rows = [user("U1", "m-1", 1_000), reply("stub", 1_500, { traceId: "T-1", receiptsUnavailable: true }, { streamingState: "errored" })];
    expect((await refused(await guard({ trigger: "regenerate-message" }))).body.code).toBe("turn_ran");

    h.rows = [user("U1", "m-1", 1_000), reply("stub", 1_500, { traceId: "T-1", toolReceipts: [] }, { streamingState: "errored" })];
    expect(await guard({ trigger: "regenerate-message" })).toMatchObject({ kind: "run" });
  });

  it("a reply with no receipts array (fast path, old row) is unknown, which blocks a regenerate", async () => {
    h.rows = [user("U1", "m-1", 1_000), reply("A1", 2_000, {}, { parentMessageId: "U1" })];
    expect((await refused(await guard({ trigger: "regenerate-message" }))).body.code).toBe("turn_ran");
  });

  it("a reply that finished after the NEXT user message still belongs to its own turn (overlap)", async () => {
    h.rows = [
      user("U1", "m-1", 1_000),
      user("U2", "m-2", 2_000),
      reply("A1", 3_000, { traceId: "T-1", toolReceipts: [write] }, { parentMessageId: "U1" }),
    ];
    expect((await refused(await guard({ trigger: "regenerate-message" }))).body.code).toBe("turn_ran");
  });

  it("a parentless stub written after the next user message is that turn's, not this one's", async () => {
    h.rows = [
      user("U1", "m-1", 1_000),
      user("U2", "m-2", 2_000),
      reply("stub", 3_000, { traceId: "T-2", toolReceipts: [write] }, { streamingState: "errored" }),
    ];
    expect(await guard({ trigger: "regenerate-message" })).toMatchObject({ kind: "run" });
  });

  it("a run that finished between the first lookup and the claim is seen: the rows are read AFTER claiming", async () => {
    h.rows = [user("U1", "m-1", 1_000), reply("A1", 2_000, { traceId: "T-old", toolReceipts: [] }, { parentMessageId: "U1" })];
    h.hideUserRowOnce = true;
    expect((await refused(await guard({ trigger: "submit-message" }))).body.code).toBe("turn_answered");
  });

  it("another turn's reply is not this turn's", async () => {
    h.rows = [
      user("U1", "m-1", 1_000),
      reply("A1", 1_500, { traceId: "T-1", toolReceipts: [write] }, { parentMessageId: "U1" }),
      user("U2", "m-2", 2_000),
    ];
    expect(await guard({ lastMessage: { id: "m-2", role: "user" }, trigger: "regenerate-message" })).toMatchObject({ kind: "run" });
  });
});

describe("a failed read is never read as 'nothing happened'", () => {
  it("an attempt exists but its replies cannot be read: refused as unreadable, claim let go", async () => {
    h.rows = [user("U1", "m-1", 1_000)];
    h.failRead = "assistantOnly";
    const r = await refused(await guard({ trigger: "regenerate-message" }));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: "turn_unreadable" });
    expect(h.finished).toBe(1);
  });

  it("the user row itself unreadable: no evidence of a prior attempt, so a send runs (a chat outage is worse)", async () => {
    h.failRead = "findFirst";
    expect(await guard()).toMatchObject({ kind: "run" });
  });

  it("...but a REGENERATE is itself evidence that an attempt exists: unreadable, refused, claim let go", async () => {
    h.failRead = "findFirst";
    const r = await refused(await guard({ trigger: "regenerate-message" }));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: "turn_unreadable" });
    expect(h.finished).toBe(1);
  });

  it("a saved reply the gate cannot even parse is unknown, not a thrown 500 that strands the claim", async () => {
    h.rows = [user("U1", "m-1", 1_000), reply("A1", 2_000, { traceId: "T-old", toolReceipts: [] }, { parentMessageId: "U1", parts: [null] })];
    const r = await refused(await guard({ trigger: "regenerate-message" }));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: "turn_unreadable" });
    expect(h.finished).toBe(1);
  });

  it("claim store down: the saved rows still decide, with no claim to hold", async () => {
    h.claimResult = { kind: "unavailable" };
    h.rows = [user("U1", "m-1", 1_000), reply("A1", 2_000, { traceId: "T-old", toolReceipts: [write] }, { parentMessageId: "U1" })];
    expect((await refused(await guard({ trigger: "regenerate-message" }))).body.code).toBe("turn_ran");
    h.rows = [];
    expect(await guard()).toEqual({ kind: "run", claim: null, conversationId: null });
  });
});
