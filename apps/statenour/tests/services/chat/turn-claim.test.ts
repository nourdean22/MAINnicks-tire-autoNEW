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
  // Run just before a create / a findUnique: the windows in which a row can appear or vanish under a racer.
  beforeCreate: undefined as undefined | (() => void),
  beforeFindUnique: undefined as undefined | (() => void),
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
        h.beforeCreate?.();
        if (h.failCreate) throw new Error("connection refused");
        if (rows().some((r) => r.category === a.data.category && r.key === a.data.key)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row: Row = { ...a.data, id: `b${++h.seq}`, deletedAt: null, updatedAt: new Date(1_000 + ++h.clock) };
        rows().push(row);
        return { id: row.id };
      },
      findUnique: async (a: { where: { category_key: { category: string; key: string } }; select?: Record<string, boolean> }) => {
        h.beforeFindUnique?.();
        if (h.failFind) throw new Error("connection reset");
        const { category, key } = a.where.category_key;
        const row = rows().find((r) => r.category === category && r.key === key);
        if (!row) return null;
        // Like the database: only the selected columns come back. A column the code forgot to select is
        // undefined, and Prisma reads `undefined` in a where as "no filter" (the CAS pin would vanish).
        return a.select ? Object.fromEntries(Object.entries(a.select).filter(([, on]) => on).map(([k]) => [k, (row as unknown as Record<string, unknown>)[k]])) : { ...row };
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

import { afterDrain, claimTurn, POST_DRAIN_GRACE_MS, TURN_BEAT_MS, TURN_BODY_IDLE_MS, TURN_LEASE_MS, TURN_MAX_RUN_MS } from "@/lib/services/chat/turn-claim";

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
  h.beforeCreate = undefined;
  h.beforeFindUnique = undefined;
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

  it("the reclaim swaps only the row it read, even when another lease has the same version and deadline", async () => {
    await expectClaimed("trace-A");
    vi.setSystemTime(new Date(T0.getTime() + TURN_LEASE_MS + 1));
    const twin: Row = { ...rows()[0], id: "twin", key: "turn:msg-other", metadata: { traceId: "trace-X", conversationId: null } };
    h.rows = [rows()[0], twin];

    await expectClaimed("trace-B");

    expect(rows().find((r) => r.id === "twin")!.metadata, "the swap overwrote a lease it never read").toMatchObject({ traceId: "trace-X" });
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

  // A row can vanish under a racer (its owner just finished, or the sweeper took it). Each of the three
  // places the code looks again has its own arm: none of them may guess "held", and none may loop forever.
  describe("a row that vanishes under the racer", () => {
    const seed = (): Row => ({
      id: "gone",
      category: "active_chat_stream",
      key: "turn:msg-1",
      content: "chat turn trace-A",
      expiresAt: new Date(Date.now() + TURN_LEASE_MS),
      deletedAt: null,
      updatedAt: new Date(1),
      metadata: { traceId: "trace-A", conversationId: null },
    });

    it("between the failed create and the read: a free slot, so the claim goes round again and wins", async () => {
      h.rows = [seed()];
      h.beforeFindUnique = () => {
        h.beforeFindUnique = undefined;
        h.rows = [];
      };

      const result = await claimTurn(claimArgs("trace-B"));

      expect(result.kind).toBe("claimed");
      expect(h.creates, "the second create is the one that won").toBe(2);
    });

    it("between a lost swap and the re-read of the winner: also a free slot", async () => {
      await expectClaimed("trace-A");
      vi.setSystemTime(new Date(T0.getTime() + TURN_LEASE_MS + 1));
      h.beforeUpdateMany = () => {
        h.beforeUpdateMany = undefined;
        rows()[0].updatedAt = new Date(9_999); // a write lands after our read: the swap misses
        let reads = 0;
        h.beforeFindUnique = () => {
          if (++reads === 1) h.rows = []; // and the winner is gone by the time we look for it
        };
      };

      const result = await claimTurn(claimArgs("trace-B"));

      expect(result.kind).toBe("claimed");
    });

    it("again and again: three rounds are all it takes, then the store counts as unavailable (fail open), never as held", async () => {
      h.beforeCreate = () => {
        if (rows().length === 0) h.rows = [seed()]; // taken just before every create
      };
      h.beforeFindUnique = () => {
        h.rows = []; // and gone just before every read
      };

      await expect(claimTurn(claimArgs("trace-B"))).resolves.toEqual({ kind: "unavailable" });
      expect(h.creates).toBe(3);
    });
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

  it("finishing deletes the claim row and frees the message", async () => {
    const claim = await expectClaimed("trace-A");
    claim.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(rows()).toHaveLength(0);
    await expectClaimed("trace-B");
  });

  // A heartbeat on a deleted row is a no-op write, so the row being gone does not show the timer stopped.
  it("finishing clears the heartbeat timer, and a rename after release writes nothing", async () => {
    const claim = await expectClaimed("trace-A");
    expect(vi.getTimerCount()).toBe(1);
    claim.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount(), "the heartbeat kept ticking after release").toBe(0);

    claim.setConversation("conv-late");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.writes, "a rename after release reached the store").toEqual([]);
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
    expect(vi.getTimerCount(), 'the heartbeat kept ticking after the reader left').toBe(0);
    expect(await claimTurn(claimArgs('trace-B'))).toMatchObject({ kind: 'in_flight', traceId: 'trace-A' });
    await vi.advanceTimersByTimeAsync(TURN_LEASE_MS + TURN_BEAT_MS); // nobody renews it any more
    await expectClaimed('trace-B');
  });

  // Next pipes the body to the socket with an abort signal, so a client that drops while the work is silent
  // cancels the stream with a read PENDING. The inner read then ends, pull() closes a cancelled stream
  // (which throws) and its catch releases: only the flag lapse() set keeps that release from deleting
  // the row of a run that is still going.
  it('a reader that leaves with a read pending does not get the lease deleted either', async () => {
    const claim = await expectClaimed('trace-A');
    const res = claim.holdWhileBodyOpen(new Response(openBody().body));
    claim.finish();
    const reader = res.body!.getReader();
    void reader.read().catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    await reader.cancel();
    await vi.advanceTimersByTimeAsync(0);

    expect(rows(), 'the lease was deleted while the work may still be running').toHaveLength(1);
    expect(await claimTurn(claimArgs('trace-B'))).toMatchObject({ kind: 'in_flight', traceId: 'trace-A' });
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
  // The very first beat finds the body idle (nothing asked for 30 s) and stops renewing, so the lease ends
  // with its first 90 s: not at the idle beat (the work may still be running) and not a beat or two later.
  it("a body nobody ever reads (the client left before the handler returned) stops being renewed and lapses", async () => {
    const claim = await expectClaimed("trace-A");
    claim.holdWhileBodyOpen(new Response(openBody().body));
    claim.finish();

    await vi.advanceTimersByTimeAsync(TURN_BODY_IDLE_MS + TURN_BEAT_MS / 2);
    expect(rows(), 'the idle beat deleted a lease whose work may still be running').toHaveLength(1);
    expect(await claimTurn(claimArgs("trace-B"))).toMatchObject({ kind: "in_flight", traceId: "trace-A" });

    await vi.advanceTimersByTimeAsync(TURN_LEASE_MS - TURN_BODY_IDLE_MS - TURN_BEAT_MS / 2 + 1_000);
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

  // A paused iOS tab, a slow link: the reader is attached and asks again within the idle window each time.
  it("a slow reader that asks again every 20 s keeps the lease well past one lease period", async () => {
    const claim = await expectClaimed("trace-A");
    const src = openBody();
    const reader = claim.holdWhileBodyOpen(new Response(src.body)).body!.getReader();

    for (let i = 0; i < 8; i += 1) {
      src.ctl().enqueue(bytes(`chunk ${i}`));
      await reader.read();
      await vi.advanceTimersByTimeAsync(20_000);
    }

    expect(await claimTurn(claimArgs("trace-B"))).toMatchObject({ kind: "in_flight", traceId: "trace-A" });
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
    expect(TURN_BODY_IDLE_MS, "the doc says a reader quiet for 30 s lapses the lease").toBe(30_000);
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
