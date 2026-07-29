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
