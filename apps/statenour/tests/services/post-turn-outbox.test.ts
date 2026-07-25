/**
 * tests/services/post-turn-outbox.test.ts — durable-outbox contracts
 * (2026-07-25 arc): payload capping, best-effort enqueue, atomic claim
 * (lost race → skipped), failed-for-good terminal state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const mockUpdate = vi.fn(() => Promise.resolve({}));
const mockUpdateMany = vi.fn();
const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    postTurnOutbox: {
      create: (a: unknown) => mockCreate(a),
      update: (a: unknown) => mockUpdate(a),
      updateMany: (a: unknown) => mockUpdateMany(a),
      findMany: (a: unknown) => mockFindMany(a),
      findUnique: (a: unknown) => mockFindUnique(a),
    },
  },
}));

import {
  toOutboxPayload,
  enqueuePostTurnWork,
  claimOrphans,
  finishClaim,
  OUTBOX_MAX_ATTEMPTS,
} from "@/lib/services/chat/post-turn-outbox";

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    convId: "c1",
    traceId: "t1",
    provider: "ollama",
    modelId: "m",
    mode: "standard",
    personality: "nick",
    topicTier: "core",
    startedAt: 1,
    userContent: "u",
    cleanedText: "a",
    text: "a",
    messages: [],
    createdAssistantId: null,
    ...over,
  }) as never;

beforeEach(() => vi.clearAllMocks());

describe("post-turn outbox", () => {
  it("caps payload messages at 20 so long conversations can't write megabyte rows", () => {
    const p = toOutboxPayload(ctx({ messages: Array.from({ length: 50 }, (_, i) => ({ i })) }));
    expect((p.messages as unknown[]).length).toBe(20);
  });

  it("enqueue is best-effort — a DB failure returns null, never throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("db down"));
    await expect(enqueuePostTurnWork(ctx())).resolves.toBeNull();
  });

  it("claim skips rows lost to a concurrent drain (updateMany count 0)", async () => {
    mockFindMany.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    mockUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mockFindUnique.mockResolvedValueOnce({ id: "a", payload: {}, attempts: 1 });
    const claimed = await claimOrphans(10);
    expect(claimed.map((c) => c.id)).toEqual(["a"]);
  });

  it("finishClaim marks failed-for-good only at the attempt cap", async () => {
    await finishClaim("x", false, OUTBOX_MAX_ATTEMPTS, new Error("boom"));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
    mockUpdate.mockClear();
    await finishClaim("x", false, 1, new Error("boom"));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pending" }),
      }),
    );
  });
});
