/**
 * turn-claim - at most one live run per user message (2026-10-15).
 *
 * Drives the REAL claimTurn over a small in-memory brain_memories store that
 * enforces the (category, key) unique key and the updatedAt version column the
 * way Postgres does. A mocked `{ count }` could not see a field missing from the
 * swap's predicate, so the race tests here share one stale read between racers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  category: string;
  key: string;
  content: string;
  expiresAt: Date | null;
  deletedAt: Date | null;
  updatedAt: Date;
  metadata: Record<string, unknown> | null;
};

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  seq: 0,
  clock: 0,
  // Runs just before an updateMany applies: the window between a racer's read and its swap.
  beforeUpdateMany: undefined as undefined | (() => void),
  failCreate: false,
  creates: 0,
  // After the claim is taken: every updateMany/deleteMany throws synchronously ("throw") or rejects ("reject").
  storeCalls: "ok" as "ok" | "throw" | "reject",
  failFind: false,
  // Every updateMany that ran: which run it was pinned to (undefined = unpinned) and how many rows it changed.
  writes: [] as Array<{ pinnedTo: unknown; count: number; kind: "beat" | "metadata" | "swap" }>,
}));

const rows = () => h.rows as Row[];

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === "metadata") {
      const { path, equals } = v as { path: string[]; equals: unknown };
      if ((row.metadata ?? {})[path[0]] !== equals) return false;
      continue;
    }
    const actual = (row as unknown as Record<string, unknown>)[k];
    if (v instanceof Date) {
      if (!(actual instanceof Date) || actual.getTime() !== v.getTime()) return false;
    } else if (actual !== v) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      create: async (a: { data: Omit<Row, "id" | "updatedAt" | "deletedAt"> }) => {
        h.creates += 1;
        if (h.failCreate) throw new Error("connection refused");
        if (rows().some((r) => r.category === a.data.category && r.key === a.data.key)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row: Row = { ...a.data, id: `b${++h.seq}`, deletedAt: null, updatedAt: new Date(1_000 + ++h.clock) };
        rows().push(row);
        return { id: row.id };
      },
      findUnique: async (a: { where: { category_key: { category: string; key: string } } }) => {
        if (h.failFind) throw new Error("connection reset");
        const { category, key } = a.where.category_key;
        const row = rows().find((r) => r.category === category && r.key === key);
        return row ? { ...row } : null;
      },
      updateMany: (a: { where: Record<string, unknown>; data: Partial<Row> }) => {
        if (h.storeCalls === "throw") throw new TypeError("updateMany is not a function");
        if (h.storeCalls === "reject") return Promise.reject(new Error("connection reset"));
        return updateManyOk(a);
      },
      deleteMany: (a: { where: Record<string, unknown> }) => {
        if (h.storeCalls === "throw") throw new TypeError("deleteMany is not a function");
        if (h.storeCalls === "reject") return Promise.reject(new Error("connection reset"));
        return deleteManyOk(a);
      },
    },
  },
}));

// Referenced only when a mocked call runs, long after this module has evaluated.
async function updateManyOk(a: { where: Record<string, unknown>; data: Partial<Row> }) {
  h.beforeUpdateMany?.();
  const hits = rows().filter((r) => matches(r, a.where));
  for (const r of hits) Object.assign(r, a.data, { updatedAt: new Date(1_000 + ++h.clock) });
  const pin = (a.where.metadata as { equals?: unknown } | undefined)?.equals;
  h.writes.push({ pinnedTo: pin, count: hits.length, kind: "id" in a.where ? "swap" : "metadata" in a.data ? "metadata" : "beat" });
  return { count: hits.length };
}
async function deleteManyOk(a: { where: Record<string, unknown> }) {
  const keep = rows().filter((r) => !matches(r, a.where));
  const count = rows().length - keep.length;
  h.rows = keep;
  return { count };
}
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { afterDrain, claimTurn, POST_DRAIN_GRACE_MS, TURN_BEAT_MS, TURN_LEASE_MS, TURN_MAX_RUN_MS } from "@/lib/services/chat/turn-claim";

const T0 = new Date("2026-10-15T12:00:00Z");
const claimArgs = (traceId: string, clientMessageId = "msg-1") => ({ clientMessageId, traceId, conversationId: null });

async function expectClaimed(traceId: string, clientMessageId = "msg-1") {
  const r = await claimTurn(claimArgs(traceId, clientMessageId));
  if (r.kind !== "claimed") throw new Error(`expected claimed, got ${r.kind}`);
  return r.claim;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  h.rows = [];
  h.seq = 0;
  h.clock = 0;
  h.beforeUpdateMany = undefined;
  h.failCreate = false;
  h.creates = 0;
  h.storeCalls = "ok";
  h.failFind = false;
  h.writes = [];
});
afterEach(() => vi.useRealTimers());

describe("claimTurn", () => {
  it("the first caller claims; a second caller for the same message is told which run holds it", async () => {
    const first = await expectClaimed("trace-A");
    first.setConversation("conv-9");
    await vi.advanceTimersByTimeAsync(0);

    const second = await claimTurn({ clientMessageId: "msg-1", traceId: "trace-B", conversationId: null });
    expect(second).toEqual({ kind: "in_flight", traceId: "trace-A", conversationId: "conv-9" });
  });

  it("different messages never contend", async () => {
    await expectClaimed("trace-A", "msg-1");
    await expectClaimed("trace-B", "msg-2");
  });

  it("a lapsed lease is reclaimed, and only by one of two racers that read the same expired row", async () => {
    await expectClaimed("trace-A");
    vi.setSystemTime(new Date(T0.getTime() + TURN_LEASE_MS + 1));

    const results = await Promise.all([claimTurn(claimArgs("trace-B")), claimTurn(claimArgs("trace-C"))]);
    const claimed = results.filter((r) => r.kind === "claimed");
    const lost = results.filter((r) => r.kind === "in_flight");
    expect(claimed).toHaveLength(1);
    expect(lost).toHaveLength(1);
    // The loser names the WINNER, not the dead run it read.
    const winnerTrace = results[0].kind === "claimed" ? "trace-B" : "trace-C";
    expect(lost[0]).toMatchObject({ traceId: winnerTrace });
  });

  // The swap must pin EVERY field the "lapsed" verdict read. A real renewal moves both the deadline and
  // the version, so each arm below changes one alone: dropping either pin from the swap fails exactly one.
  const slowOwnerLandsAfterTheRead = async (touch: (r: Row) => void) => {
    await expectClaimed("trace-A");
    vi.setSystemTime(new Date(T0.getTime() + TURN_LEASE_MS + 1));
    h.beforeUpdateMany = () => {
      h.beforeUpdateMany = undefined;
      touch(rows()[0]);
    };
    const result = await claimTurn(claimArgs("trace-B"));
    expect(result).toMatchObject({ kind: "in_flight", traceId: "trace-A" });
    expect(rows()[0].metadata).toMatchObject({ traceId: "trace-A" });
  };

  it("a renewal that moves only the deadline beats the reclaimer", () =>
    slowOwnerLandsAfterTheRead((r) => {
      r.expiresAt = new Date(Date.now() + TURN_LEASE_MS);
    }));

  it("a write that bumps only the version beats the reclaimer", () =>
    slowOwnerLandsAfterTheRead((r) => {
      r.updatedAt = new Date(9_999);
    }));

  it("a store failure is 'unavailable', never a throw and never a refusal (fail open), and is not retried", async () => {
    h.failCreate = true;
    await expect(claimTurn(claimArgs("trace-A"))).resolves.toEqual({ kind: "unavailable" });
    expect(h.creates, "a non-unique create error is not a taken slot: one attempt").toBe(1);
  });

  it("a failure while reading or reclaiming a held row is also 'unavailable'", async () => {
    await expectClaimed("trace-A");
    h.failFind = true;
    await expect(claimTurn(claimArgs("trace-B"))).resolves.toEqual({ kind: "unavailable" });
  });

  // lib/brain/memory-consolidation.ts pruneNoise soft-deletes EVERY brain_memories row past its expiresAt, so a
  // lapsed lease becomes a soft-deleted row and the next claim always takes the reclaim path.
  it("a soft-deleted row is a free slot, and the lease taken over it then HOLDS", async () => {
    await expectClaimed("trace-A");
    rows()[0].deletedAt = new Date(T0);
    await expectClaimed("trace-B");
    expect(rows()[0].deletedAt, "the reclaimed row is still soft-deleted: every later claim would reclaim it and run").toBeNull();
    expect(await claimTurn(claimArgs("trace-C"))).toMatchObject({ kind: "in_flight", traceId: "trace-B" });
  });

  it("a lease row with no deadline is not live forever", async () => {
    await expectClaimed("trace-A");
    rows()[0].expiresAt = null;
    await expectClaimed("trace-B");
  });
});

describe("heartbeat and lifetime", () => {
  it("renews the lease while the run is alive, so a long turn is never reclaimed", async () => {
    const claim = await expectClaimed("trace-A");
    await vi.advanceTimersByTimeAsync(TURN_BEAT_MS * 6); // 180s, longer than one lease
    expect(rows()[0].expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await claimTurn(claimArgs("trace-B"))).toMatchObject({ kind: "in_flight", traceId: "trace-A" });
    claim.finish();
  });

  it("stops renewing once finished, and the claim row is gone", async () => {
    const claim = await expectClaimed("trace-A");
    claim.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(0);
    await expectClaimed("trace-B");
  });

  it("a hung run cannot hold the message forever: renewals stop after the max run time", async () => {
    await expectClaimed("trace-A");
    await vi.advanceTimersByTimeAsync(TURN_MAX_RUN_MS + TURN_LEASE_MS + TURN_BEAT_MS);
    await expectClaimed("trace-B");
  });

  // The old owner keeps ticking after a reclaim. Each of its three kinds of write must be pinned to its own trace:
  // the log of every updateMany says which run each was pinned to and how many rows it changed.
  it("a displaced owner can neither extend, rename nor delete the new owner's claim", async () => {
    const old = await expectClaimed("trace-A");
    vi.setSystemTime(new Date(T0.getTime() + TURN_LEASE_MS + 1));
    await expectClaimed("trace-B");
    h.writes = [];

    await vi.advanceTimersByTimeAsync(TURN_BEAT_MS * 2); // both owners' heartbeats fire
    old.setConversation("conv-A");
    old.finish();
    await vi.advanceTimersByTimeAsync(0);

    const byA = h.writes.filter((w) => w.pinnedTo !== "trace-B");
    expect(byA.length, "the old owner's heartbeat and rename must have run, or this proves nothing").toBeGreaterThanOrEqual(2);
    expect(byA.filter((w) => w.count > 0), "a write by the old owner changed the new owner's row").toEqual([]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].metadata).toMatchObject({ traceId: "trace-B", conversationId: null });
  });
});

describe("a failing store never reaches the caller", () => {
  it("finish(), setConversation() and the heartbeat swallow a store that throws synchronously or rejects", async () => {
    const claim = await expectClaimed("trace-A");
    h.storeCalls = "throw";
    expect(() => claim.setConversation("conv-9")).not.toThrow();
    // A throw inside a timer callback would be an uncaught exception, not a rejected promise.
    await expect(vi.advanceTimersByTimeAsync(TURN_BEAT_MS * 2)).resolves.not.toThrow();
    expect(() => claim.finish()).not.toThrow();

    h.storeCalls = "reject";
    const next = await expectClaimed("trace-B", "msg-2");
    expect(() => next.setConversation("conv-9")).not.toThrow();
    await vi.advanceTimersByTimeAsync(TURN_BEAT_MS * 2);
    expect(() => next.finish()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("settlement", () => {
  it("finish() with nothing bound releases at once (every non-streaming return)", async () => {
    const claim = await expectClaimed("trace-A");
    claim.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(0);
  });

  it("settleWith() keeps the claim past finish() until the run itself ends", async () => {
    const claim = await expectClaimed("trace-A");
    let end!: () => void;
    claim.settleWith(new Promise<void>((resolve) => (end = resolve)));
    claim.finish(); // the handler returned its Response; the run is still going
    await vi.advanceTimersByTimeAsync(0);
    expect(await claimTurn(claimArgs("trace-B"))).toMatchObject({ kind: "in_flight", traceId: "trace-A" });

    end();
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(0);
    await expectClaimed("trace-B");
  });

  it("a run that rejects still releases", async () => {
    const claim = await expectClaimed("trace-A");
    claim.settleWith(Promise.reject(new Error("stream blew up")));
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(0);
  });
});

describe("holdWhileBodyOpen: a response whose body still does the work of the run", () => {
  // An image or an alternate lane produces its answer INSIDE the returned stream, after the handler has returned.
  const openBody = () => {
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
    return { body, ctl: () => ctl };
  };
  const bytes = (s: string) => new TextEncoder().encode(s);

  it('keeps the lease after the handler returns, and releases when the body closes', async () => {
    const claim = await expectClaimed('trace-A');
    const src = openBody();
    const res = claim.holdWhileBodyOpen(new Response(src.body, { status: 200, headers: { 'X-Trace-Id': 'trace-A' } }));
    claim.finish(); // the handler returned
    await vi.advanceTimersByTimeAsync(0);
    expect(await claimTurn(claimArgs('trace-B'))).toMatchObject({ kind: 'in_flight', traceId: 'trace-A' });

    src.ctl().enqueue(bytes('hello'));
    src.ctl().close();
    expect(await res.text()).toBe('hello');
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(0);
  });

  it('passes status, headers and bytes through untouched', async () => {
    const claim = await expectClaimed('trace-A');
    const res = claim.holdWhileBodyOpen(new Response('ok', { status: 201, statusText: 'Made', headers: { 'X-Trace-Id': 'trace-A', 'Content-Type': 'text/event-stream' } }));
    expect(res.status).toBe(201);
    expect(res.statusText).toBe('Made');
    expect(res.headers.get('X-Trace-Id')).toBe('trace-A');
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await res.text()).toBe('ok');
  });

  it('a reader that leaves first does NOT delete the lease (the work goes on) but stops renewing it', async () => {
    const claim = await expectClaimed('trace-A');
    const src = openBody();
    const res = claim.holdWhileBodyOpen(new Response(src.body));
    claim.finish();
    await res.body!.cancel();
    await vi.advanceTimersByTimeAsync(0);

    expect(rows()).toHaveLength(1);
    expect(await claimTurn(claimArgs('trace-B'))).toMatchObject({ kind: 'in_flight', traceId: 'trace-A' });
    await vi.advanceTimersByTimeAsync(TURN_LEASE_MS + TURN_BEAT_MS); // nobody renews it any more
    await expectClaimed('trace-B');
  });

  it('a body that errors releases', async () => {
    const claim = await expectClaimed('trace-A');
    const src = openBody();
    const res = claim.holdWhileBodyOpen(new Response(src.body));
    claim.finish();
    src.ctl().error(new Error('generation failed'));
    await expect(res.text()).rejects.toThrow('generation failed');
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(0);
  });

  it.each([
    ['an error status', () => new Response('nope', { status: 402 })],
    ['no body', () => new Response(null, { status: 204 })],
  ])('%s: nothing is running, so it releases at once', async (_n, make) => {
    const claim = await expectClaimed('trace-A');
    const res = make();
    expect(claim.holdWhileBodyOpen(res)).toBe(res);
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(0);
  });

  it('a lease already bound to the run (settleWith) is left alone', async () => {
    const claim = await expectClaimed('trace-A');
    claim.settleWith(new Promise(() => {}));
    const res = new Response(openBody().body);
    expect(claim.holdWhileBodyOpen(res)).toBe(res);
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(1);
  });
});

describe("holdWhileBodyOpen: a body that is not being read", () => {
  const openBody = () => {
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
    return { body, ctl: () => ctl };
  };
  const bytes = (v: string) => new TextEncoder().encode(v);

  it("keeps the lease after a chunk has streamed and until the body closes (an early-streaming body that keeps working)", async () => {
    const claim = await expectClaimed("trace-A");
    const src = openBody();
    const reader = claim.holdWhileBodyOpen(new Response(src.body)).body!.getReader();
    claim.finish();
    src.ctl().enqueue(bytes("first"));
    await reader.read();
    await vi.advanceTimersByTimeAsync(0);
    expect(await claimTurn(claimArgs("trace-B"))).toMatchObject({ kind: "in_flight", traceId: "trace-A" });

    src.ctl().close();
    await reader.read();
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(0);
  });

  // Next does not read or cancel the body of a response whose socket closed before the handler returned.
  it("a body nobody ever reads (the client left before the handler returned) stops being renewed and lapses", async () => {
    const claim = await expectClaimed("trace-A");
    claim.holdWhileBodyOpen(new Response(openBody().body));
    claim.finish();

    await vi.advanceTimersByTimeAsync(TURN_BEAT_MS * 3 + TURN_LEASE_MS);

    await expectClaimed("trace-B");
  });

  it("a reader that took a chunk and then stopped asking is idle too", async () => {
    const claim = await expectClaimed("trace-A");
    const src = openBody();
    const reader = claim.holdWhileBodyOpen(new Response(src.body)).body!.getReader();
    src.ctl().enqueue(bytes("first"));
    await reader.read();

    await vi.advanceTimersByTimeAsync(TURN_BEAT_MS * 3 + TURN_LEASE_MS);

    await expectClaimed("trace-B");
  });

  it("a reader that is WAITING on a silent upstream (the work is running, the client is there) keeps the lease", async () => {
    const claim = await expectClaimed("trace-A");
    const reader = claim.holdWhileBodyOpen(new Response(openBody().body)).body!.getReader();
    void reader.read();

    await vi.advanceTimersByTimeAsync(TURN_MAX_RUN_MS - TURN_BEAT_MS);

    expect(await claimTurn(claimArgs("trace-B"))).toMatchObject({ kind: "in_flight", traceId: "trace-A" });
  });
});

describe("the documented bounds", () => {
  it("pins the numbers the design doc quotes", () => {
    expect(TURN_BEAT_MS).toBe(30_000);
    expect(TURN_LEASE_MS, "two beats can be lost before the lease lapses").toBe(3 * TURN_BEAT_MS);
    expect(TURN_MAX_RUN_MS).toBe(6 * 60_000);
    expect(POST_DRAIN_GRACE_MS).toBe(60_000);
  });

  it("a live run is never reclaimable between two heartbeats", async () => {
    await expectClaimed("trace-A");
    await vi.advanceTimersByTimeAsync(TURN_BEAT_MS * 3 - 1); // one ms before the third beat
    expect(await claimTurn(claimArgs("trace-B"))).toMatchObject({ kind: "in_flight", traceId: "trace-A" });
  });
});

describe('afterDrain: when the streaming run is over', () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
    promise.catch(() => {});
    return { promise, resolve, reject };
  };
  const state = async (p: Promise<unknown>) => {
    let done = false;
    void p.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    return done ? 'done' : 'pending';
  };

  it('waits for the drain AND the persist', async () => {
    const drained = deferred();
    const persisted = deferred();
    const run = afterDrain(drained.promise, persisted.promise);
    expect(await state(run)).toBe('pending');
    drained.resolve();
    expect(await state(run)).toBe('pending');
    persisted.resolve();
    expect(await state(run)).toBe('done');
  });

  it('a persist that finished EARLY (an error part) still waits for the drain', async () => {
    const drained = deferred();
    const persisted = deferred();
    persisted.resolve();
    const run = afterDrain(drained.promise, persisted.promise);
    expect(await state(run)).toBe('pending');
    drained.resolve();
    expect(await state(run)).toBe('done');
  });

  it('a persist that never reports is given the grace period after the drain, then the run is over', async () => {
    const drained = deferred();
    const run = afterDrain(drained.promise, new Promise(() => {}));
    drained.resolve();
    await vi.advanceTimersByTimeAsync(POST_DRAIN_GRACE_MS - 1);
    expect(await state(run)).toBe('pending');
    await vi.advanceTimersByTimeAsync(2);
    expect(await state(run)).toBe('done');
  });

  it('the grace is counted from the drain, not from the start of the run', async () => {
    const drained = deferred();
    const run = afterDrain(drained.promise, new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(POST_DRAIN_GRACE_MS * 3);
    expect(await state(run)).toBe('pending');
    drained.resolve();
    expect(await state(run)).toBe('pending');
  });

  it('a drain that rejects still ends the run once the persist has finished', async () => {
    const drained = deferred();
    const persisted = deferred();
    const run = afterDrain(drained.promise, persisted.promise);
    drained.reject(new Error('consumeStream failed'));
    persisted.resolve();
    expect(await state(run)).toBe('done');
  });
});
