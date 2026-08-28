/**
 * tests/services/active-stream.test.ts — WP-A durable streams
 * (2026-07-29): registry lifecycle honesty + the pure replay builder.
 * Invariants pinned: complete only extends a real record; expired or
 * deleted rows read as absent; replay chunks reproduce the persisted
 * text exactly and never invent content.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpsert = vi.fn(() => Promise.resolve({}));
const mockUpdate = vi.fn(() => Promise.resolve({}));
const mockFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      upsert: (a: unknown) => mockUpsert(a),
      update: (a: unknown) => mockUpdate(a),
      findUnique: (a: unknown) => mockFindUnique(a),
    },
  },
}));

import {
  registerActiveStream,
  completeActiveStream,
  getActiveStream,
  buildReplayChunks,
  persistPartialStream,
  createPartialPersister,
  resumeMessageId,
  buildOpenChunks,
  buildDeltaChunk,
  buildCloseChunks,
} from "@/lib/services/chat/active-stream";

beforeEach(() => vi.clearAllMocks());

describe("active-stream registry", () => {
  it("register upserts an active record with a TTL — crashed turns self-expire", async () => {
    await registerActiveStream("c1", "trace-1");
    const arg = mockUpsert.mock.calls[0][0] as {
      create: { metadata: { status: string }; expiresAt: Date };
    };
    expect(arg.create.metadata.status).toBe("active");
    expect(arg.create.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("complete is a no-op when no record exists (never invents one)", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    await completeActiveStream("c1");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("complete marks status complete and shortens the linger window", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "row1", metadata: { status: "active", traceId: "t" } });
    await completeActiveStream("c1");
    const arg = mockUpdate.mock.calls[0][0] as {
      data: { metadata: { status: string }; expiresAt: Date };
    };
    expect(arg.data.metadata.status).toBe("complete");
    expect(arg.data.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3 * 60 * 1000 + 1000);
  });

  it("expired and deleted rows read as absent — a stale stream never blocks", async () => {
    mockFindUnique.mockResolvedValueOnce({
      metadata: { status: "active", startedAt: "2026-07-29T00:00:00Z" },
      expiresAt: new Date(Date.now() - 1000),
      deletedAt: null,
    });
    expect(await getActiveStream("c1")).toBeNull();
    mockFindUnique.mockResolvedValueOnce({
      metadata: { status: "complete" },
      expiresAt: new Date(Date.now() + 60_000),
      deletedAt: new Date(),
    });
    expect(await getActiveStream("c1")).toBeNull();
  });

  it("register failure is swallowed (fire-and-forget) — the turn must never break", async () => {
    mockUpsert.mockRejectedValueOnce(new Error("db down"));
    await expect(registerActiveStream("c1", null)).resolves.toBeUndefined();
  });
});

describe("buildReplayChunks", () => {
  it("wraps the exact persisted text in start/text/finish framing", () => {
    const chunks = buildReplayChunks("m1", "hello world");
    expect(chunks[0]).toEqual({ type: "start", messageId: "m1" });
    expect(chunks[1]).toEqual({ type: "text-start", id: "m1-text" });
    expect(chunks[2]).toEqual({ type: "text-delta", id: "m1-text", delta: "hello world" });
    expect(chunks.at(-2)).toEqual({ type: "text-end", id: "m1-text" });
    expect(chunks.at(-1)).toEqual({ type: "finish" });
  });

  it("long replies split into deltas that reassemble to the exact original", () => {
    const text = "x".repeat(4500) + "END";
    const chunks = buildReplayChunks("m1", text);
    const rebuilt = chunks
      .filter((c) => c.type === "text-delta")
      .map((c) => c.delta as string)
      .join("");
    expect(rebuilt).toBe(text);
  });

  it("empty content still frames a valid (empty) text part — never fabricates", () => {
    const chunks = buildReplayChunks("m1", "");
    const deltas = chunks.filter((c) => c.type === "text-delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0].delta).toBe("");
  });
});


/**
 * V2 partial live-tail (2026-08-28 · WP2). The defect these pin: a turn
 * still generating at reconnect replayed NOTHING (the route returned 204
 * unless status === "complete"), so measured 132s-mean deep turns — the
 * exact "complex tasks" the operator reports as broken — destroyed their
 * own work on any disconnect.
 */
describe("V2 · durable partial capture", () => {
  it("writes partial text to METADATA, never to content (recall-pollution guard)", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "r1", metadata: { status: "active" } });
    await persistPartialStream("c1", "hello world");
    const arg = mockUpdate.mock.calls[0][0] as {
      data: { metadata: Record<string, unknown>; content?: unknown };
    };
    expect(arg.data.metadata.partialText).toBe("hello world");
    // Positive control: the write happened at all, so the assertion
    // below is about column CHOICE, not about a no-op update.
    expect(arg.data.metadata.partialAt).toEqual(expect.any(String));
    // `content` is the column contextual recall reads. Assistant prose
    // must never land there via this path.
    expect(arg.data.content).toBeUndefined();
  });

  it("refuses to reopen a COMPLETED turn (late flush racing completion)", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "r1", metadata: { status: "complete" } });
    await persistPartialStream("c1", "late bytes");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("no row yet → no write, no throw (flush racing registration)", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    await expect(persistPartialStream("c1", "early")).resolves.toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("getActiveStream surfaces partialText, defaulting to empty", async () => {
    mockFindUnique.mockResolvedValueOnce({
      metadata: { status: "active", startedAt: "2026-08-28T00:00:00.000Z", partialText: "abc" },
      expiresAt: new Date(Date.now() + 60_000),
      deletedAt: null,
    });
    expect((await getActiveStream("c1"))?.partialText).toBe("abc");

    mockFindUnique.mockResolvedValueOnce({
      metadata: { status: "active", startedAt: "2026-08-28T00:00:00.000Z" },
      expiresAt: new Date(Date.now() + 60_000),
      deletedAt: null,
    });
    expect((await getActiveStream("c1"))?.partialText).toBe("");
  });
});

describe("V2 · flush throttle protects the streaming hot path", () => {
  it("drops calls inside the window — a per-delta caller must not write per delta", async () => {
    vi.useFakeTimers();
    try {
      mockFindUnique.mockResolvedValue({ id: "r1", metadata: { status: "active" } });
      const flush = createPartialPersister("c1", 2000);
      // Simulate a burst of deltas well inside one window.
      for (let i = 0; i < 50; i++) flush("chunk" + i);
      expect(mockFindUnique).not.toHaveBeenCalled(); // seeded to now
      await vi.advanceTimersByTimeAsync(2100);
      flush("after-window");
      await vi.advanceTimersByTimeAsync(10);
      // Positive control: crossing the window DOES flush, so the
      // assertion above pins throttling, not a dead function.
      expect(mockFindUnique).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("V2 · resume identity + tail chunk shape", () => {
  it("resume id is deterministic per (conversation, turn) — reconnect storms collapse to ONE bubble", () => {
    const a = resumeMessageId("conv-1", "2026-08-28T00:00:00.000Z");
    const b = resumeMessageId("conv-1", "2026-08-28T00:00:00.000Z");
    expect(a).toBe(b);
    // A different turn in the same conversation must NOT collide.
    expect(resumeMessageId("conv-1", "2026-08-28T00:00:05.000Z")).not.toBe(a);
  });

  it("open/delta/close reproduce the same part id, so deltas append to one message", () => {
    const id = "m1";
    const open = buildOpenChunks(id);
    const delta = buildDeltaChunk(id, "more");
    const close = buildCloseChunks(id);
    expect(open[0]).toEqual({ type: "start", messageId: id });
    const partId = (open[1] as { id: string }).id;
    expect((delta as { id: string }).id).toBe(partId);
    expect((close[0] as { id: string }).id).toBe(partId);
    expect(close[1]).toEqual({ type: "finish" });
  });

  it("tail primitives concatenate to the SAME chunk sequence as a one-shot replay", () => {
    // Equivalence check: incremental emission must not produce a
    // different client-visible message than the completed-turn path.
    const oneShot = buildReplayChunks("m1", "abcdef");
    const incremental = [
      ...buildOpenChunks("m1"),
      buildDeltaChunk("m1", "abc"),
      buildDeltaChunk("m1", "def"),
      ...buildCloseChunks("m1"),
    ];
    const text = (chunks: Array<Record<string, unknown>>) =>
      chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
    expect(text(incremental)).toBe(text(oneShot));
    expect(incremental[0]).toEqual(oneShot[0]);
    expect(incremental.at(-1)).toEqual(oneShot.at(-1));
  });
});
