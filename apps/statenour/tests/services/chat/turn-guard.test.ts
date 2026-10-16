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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

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
  routerReason?: string;
  createdAt: Date;
};

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  failRead: undefined as undefined | "findFirst" | "findMany" | "assistantOnly",
  // The first user-row lookup misses, as if the row landed between it and the claim.
  hideUserRowOnce: false,
  // The next N user-row lookups throw (a transient Neon failure), then they work again.
  failUserLookups: 0,
  // A user-row lookup / replies read / claim that never answers.
  hang: undefined as undefined | "user" | "replies" | "claim",
  // Runs inside the claim: a run that finishes while we claim.
  onClaim: undefined as undefined | (() => void),
  // Replaces the stubbed claim outcome with one computed from the request (a lease table).
  claimImpl: undefined as undefined | ((input: { clientMessageId: string }) => unknown),
  releaseClaim: undefined as undefined | (() => void),
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
// Like the database: only the selected columns come back, so a column the code forgot to select is undefined.
const project = (row: Row, select?: Record<string, boolean>) =>
  select
    ? Object.fromEntries(Object.entries(select).filter(([, on]) => on).map(([k]) => [k, (row as unknown as Record<string, unknown>)[k]]))
    : { ...row };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: {
      findFirst: async (a: { where: Record<string, unknown>; orderBy?: { createdAt?: string }; select?: Record<string, boolean> }) => {
        if (h.failRead === "findFirst") throw new Error("neon: connection terminated");
        if (h.failRead === "assistantOnly" && a.where.role === "assistant") throw new Error("neon: connection terminated");
        const isUserLookup = a.where.role === "user" && (a.where.clientMessageId !== undefined || a.where.OR !== undefined);
        if (isUserLookup && h.hang === "user") return new Promise(() => {});
        if (isUserLookup && h.failUserLookups > 0) {
          h.failUserLookups -= 1;
          throw new Error("neon: connection terminated");
        }
        if (h.hideUserRowOnce && isUserLookup) {
          h.hideUserRowOnce = false;
          return null;
        }
        const hit = pick(a)[0];
        return hit ? project(hit, a.select) : null;
      },
      findMany: async (a: { where: Record<string, unknown>; orderBy?: { createdAt?: string }; select?: Record<string, boolean> }) => {
        if (h.hang === "replies") return new Promise(() => {});
        if (h.failRead === "findMany" || h.failRead === "assistantOnly") throw new Error("neon: connection terminated");
        return pick(a).map((r) => project(r, a.select));
      },
    },
  },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/services/chat/turn-claim", () => ({
  claimTurn: vi.fn(async (input: { clientMessageId: string }) => {
    h.claimCalls.push(input);
    if (h.hang === "claim") return new Promise((resolve) => void (h.releaseClaim = () => resolve(h.claimResult)));
    h.onClaim?.();
    return h.claimImpl ? h.claimImpl(input) : h.claimResult;
  }),
}));

import { GUARD_STEP_TIMEOUT_MS, FOLLOW_UP_ROUTER_REASON, guardTurn, type TurnGuardResult } from "@/lib/services/chat/turn-guard";

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
  h.failUserLookups = 0;
  h.hang = undefined;
  h.onClaim = undefined;
  h.claimImpl = undefined;
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

describe("the lease key follows the message's real identity", () => {
  // Every claim handed out, in order: the wrong-key claim and the right-key one are different objects.
  let made: Array<ReturnType<typeof claim>> = [];
  beforeEach(() => {
    made = [];
  });
  const leaseTable = (taken: string[]) => {
    const leases = new Set(taken);
    h.claimImpl = (input) => {
      if (leases.has(input.clientMessageId)) return { kind: "in_flight", traceId: "T-live", conversationId: "conv-1" };
      leases.add(input.clientMessageId);
      const outcome = claimed();
      made.push(outcome.claim);
      return outcome;
    };
  };
  const keys = () => h.claimCalls.map((c) => (c as { clientMessageId: string }).clientMessageId);

  // A hydrated Regenerate names the message by database id (C1); the live run holds the lease under the minted id (U1).
  // If the first lookup fails, the lease is first taken under C1. Once the row resolves, that is the wrong key.
  it("a first lookup that failed, then resolved the row: the lease is re-keyed and the live run's lease refuses it", async () => {
    h.rows = [user("C1", "U1", 1_000)];
    leaseTable(["U1"]);
    h.failUserLookups = 1;

    const r = await refused(await guard({ lastMessage: { id: "C1", role: "user" }, trigger: "regenerate-message" }));

    expect(r.body.code).toBe("turn_in_flight");
    expect(keys()).toEqual(["C1", "U1"]);
    expect(h.finished, "the lease taken under the wrong key must be let go").toBe(1);
  });

  it("...and when the canonical lease is free it runs under THAT key, holding one lease, not two", async () => {
    h.rows = [user("C1", "U1", 1_000)];
    leaseTable([]);
    h.failUserLookups = 1;

    const result = await guard({ lastMessage: { id: "C1", role: "user" }, trigger: "regenerate-message" });

    expect(result).toMatchObject({ kind: "run", conversationId: "conv-1" });
    expect(keys()).toEqual(["C1", "U1"]);
    expect(h.finished).toBe(1);
    // The route settles or finishes the claim it is handed. If that were the first one, already let go,
    // the lease under the real key would have no owner and would lock the message until it lapses.
    expect(made).toHaveLength(2);
    expect(result.kind === "run" ? result.claim : null, "the route was handed the wrong-key claim").toBe(made[1]);
    expect(made[0].finish).toHaveBeenCalledTimes(1);
    expect(made[1].finish, "the claim under the real key must still be live").not.toHaveBeenCalled();
  });

  it("CONTROL - no failure: one claim, under the minted id", async () => {
    h.rows = [user("C1", "U1", 1_000)];
    leaseTable([]);
    await guard({ lastMessage: { id: "C1", role: "user" }, trigger: "regenerate-message" });
    expect(keys()).toEqual(["U1"]);
  });
});

describe("a read failure is judged per read", () => {
  it("a failed first read followed by a clean one is not a failure: a regenerate of a message that never saved runs", async () => {
    h.failUserLookups = 1;
    expect(await guard({ trigger: "regenerate-message" })).toMatchObject({ kind: "run" });
  });

  it("CONTROL - the last read failing too is still refused for a regenerate", async () => {
    h.failUserLookups = 2;
    expect((await refused(await guard({ trigger: "regenerate-message" }))).status).toBe(503);
  });
});

describe("what a refusal tells the client", () => {
  it("an in-flight refusal names the thread from the saved user row when the lease has none yet", async () => {
    h.rows = [user("U1", "m-1", 1_000, "conv-first")];
    h.claimResult = { kind: "in_flight", traceId: "T-live", conversationId: null };
    const r = await refused(await guard({ conversationId: undefined }));
    expect(r.headers.get("X-Conversation-Id")).toBe("conv-first");
  });

  it("every refusal says which kind it is in X-Turn-Refusal (the transport reads it)", async () => {
    h.claimResult = { kind: "in_flight", traceId: "T-live", conversationId: "conv-1" };
    expect((await refused(await guard())).headers.get("X-Turn-Refusal")).toBe("turn_in_flight");

    h.claimResult = claimed();
    h.rows = [user("U1", "m-1", 1_000), reply("A1", 2_000, { traceId: "T-old", toolReceipts: [write] }, { parentMessageId: "U1" })];
    expect((await refused(await guard({ trigger: "regenerate-message" }))).headers.get("X-Turn-Refusal")).toBe("turn_ran");
    expect((await refused(await guard({ trigger: "submit-message" }))).headers.get("X-Turn-Refusal")).toBe("turn_answered");
    h.rows = [user("U1", "m-1", 1_000)];
    h.failRead = "findMany";
    expect((await refused(await guard({ trigger: "submit-message" }))).headers.get("X-Turn-Refusal")).toBe("turn_unreadable");
  });

  // A refusal answers one POST for one message. A cache between the client and the server must not
  // keep it and serve it to the next attempt.
  it("no refusal can be cached", async () => {
    h.claimResult = { kind: "in_flight", traceId: "T-live", conversationId: "conv-1" };
    expect((await refused(await guard())).headers.get("Cache-Control")).toBe("no-store");

    h.claimResult = claimed();
    h.rows = [user("U1", "m-1", 1_000), reply("A1", 2_000, { traceId: "T-old", toolReceipts: [] }, { parentMessageId: "U1" })];
    expect((await refused(await guard())).headers.get("Cache-Control")).toBe("no-store");
  });

  it("no refusal copy promises a reply will appear (nothing on the client re-reads the thread)", async () => {
    const reasons: string[] = [];
    h.claimResult = { kind: "in_flight", traceId: "T-live", conversationId: "conv-1" };
    reasons.push(String((await refused(await guard())).body.reason));

    h.claimResult = claimed();
    h.rows = [user("U1", "m-1", 1_000), reply("A1", 2_000, { traceId: "T-old", toolReceipts: [write] }, { parentMessageId: "U1" })];
    reasons.push(String((await refused(await guard())).body.reason)); // turn_answered
    reasons.push(String((await refused(await guard({ trigger: "regenerate-message" }))).body.reason)); // turn_ran

    h.failRead = "findMany";
    reasons.push(String((await refused(await guard())).body.reason)); // turn_unreadable

    expect(reasons).toHaveLength(4);
    for (const reason of reasons) expect(reason).not.toMatch(/appear/i);
  });

  it("the trace on a refusal is the NEWEST reply's", async () => {
    h.rows = [
      user("U1", "m-1", 1_000),
      reply("stub", 1_500, { traceId: "T-stub", toolReceipts: [] }, { streamingState: "errored" }),
      reply("final", 2_000, { traceId: "T-final", toolReceipts: [] }, { parentMessageId: "U1" }),
    ];
    const r = await refused(await guard({ trigger: "submit-message" }));
    expect(r.headers.get("X-Trace-Id")).toBe("T-final");
  });
});

describe("the replies are read AFTER the claim", () => {
  it("a run that finished while we were claiming has saved its reply by the time we read", async () => {
    h.rows = [user("U1", "m-1", 1_000)];
    h.onClaim = () => {
      h.rows.push(reply("A1", 2_000, { traceId: "T-old", toolReceipts: [] }, { parentMessageId: "U1" }));
    };
    expect((await refused(await guard({ trigger: "submit-message" }))).body.code).toBe("turn_answered");
  });
});

describe("a saved reply is judged by what it SAYS, not only by its receipts", () => {
  const actionText = 'Done.\n```action\n{"type":"task.create","params":{}}\n```';

  it("an action block in the saved parts blocks a regenerate even with an empty receipts array", async () => {
    h.rows = [
      user("U1", "m-1", 1_000),
      reply("A1", 2_000, { traceId: "T-old", toolReceipts: [] }, { parentMessageId: "U1", parts: [{ type: "text", text: actionText }] }),
    ];
    expect((await refused(await guard({ trigger: "regenerate-message" }))).body.code).toBe("turn_ran");
  });

  it("...and when only the stored text carries it (no parts tree)", async () => {
    h.rows = [user("U1", "m-1", 1_000), reply("A1", 2_000, { traceId: "T-old", toolReceipts: [] }, { parentMessageId: "U1", parts: undefined, content: actionText })];
    expect((await refused(await guard({ trigger: "regenerate-message" }))).body.code).toBe("turn_ran");
  });
});

describe("an agent follow-up is not the answer to the message", () => {
  const followUp = (at: number) => reply("F1", at, null, { routerReason: FOLLOW_UP_ROUTER_REASON });

  it.each(["submit-message", "regenerate-message"])("%s: a follow-up posted after an unanswered message does not block it", async (trigger) => {
    h.rows = [user("U1", "m-1", 1_000), followUp(2_000)];
    expect(await guard({ trigger })).toMatchObject({ kind: "run" });
  });

  it("CONTROL - a parentless 'Action receipts' post has no marker and still counts: it records actions that ran", async () => {
    h.rows = [user("U1", "m-1", 1_000), reply("R1", 2_000, null)];
    expect((await refused(await guard({ trigger: "regenerate-message" }))).body.code).toBe("turn_ran");
    expect((await refused(await guard({ trigger: "submit-message" }))).body.code).toBe("turn_answered");
  });

  it("the marker is the one run-follow-up.ts writes", () => {
    const source = readFileSync("lib/agent/run-follow-up.ts", "utf8");
    expect(source).toContain(`export const FOLLOWUP_MARKER = "${FOLLOW_UP_ROUTER_REASON}";`);
  });
});

describe("the guard is bounded: a stalled database is an outage, not a wait", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const stalled = async <T,>(p: Promise<T>) => {
    // Literal seconds, not the constant: a bound that drifts to a minute must fail here, not adapt.
    await vi.advanceTimersByTimeAsync(4 * 3_000);
    return p;
  };

  it("each step is bounded to three seconds", () => {
    expect(GUARD_STEP_TIMEOUT_MS).toBe(3_000);
  });

  it("a user-row lookup that never answers: a send runs", async () => {
    h.hang = "user";
    expect(await stalled(guard())).toMatchObject({ kind: "run" });
  });

  it("...and a regenerate is refused, because it proves an attempt exists", async () => {
    h.hang = "user";
    expect((await refused(await stalled(guard({ trigger: "regenerate-message" })))).status).toBe(503);
  });

  it("a replies read that never answers: unreadable, and the lease is let go", async () => {
    h.rows = [user("U1", "m-1", 1_000)];
    h.hang = "replies";
    const r = await refused(await stalled(guard()));
    expect(r.status).toBe(503);
    expect(h.finished).toBe(1);
  });

  it("a claim that never answers: the turn runs without one, and a lease that lands late is let go", async () => {
    h.hang = "claim";
    const result = await stalled(guard());
    expect(result).toEqual({ kind: "run", claim: null, conversationId: null });

    h.releaseClaim!();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.finished, "an orphaned lease would heartbeat for minutes with nobody to finish it").toBe(1);
  });
});
