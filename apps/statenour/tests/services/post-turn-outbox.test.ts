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
const mockFindFirst = vi.fn(() => Promise.resolve(null));
const mockCount = vi.fn(() => Promise.resolve(0));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    postTurnOutbox: {
      create: (a: unknown) => mockCreate(a),
      update: (a: unknown) => mockUpdate(a),
      updateMany: (a: unknown) => mockUpdateMany(a),
      findMany: (a: unknown) => mockFindMany(a),
      findUnique: (a: unknown) => mockFindUnique(a),
      findFirst: (a: unknown) => mockFindFirst(a),
      count: (a: unknown) => mockCount(a),
    },
  },
}));

import {
  toOutboxPayload,
  enqueuePostTurnWork,
  claimOrphans,
  finishClaim,
  getOutboxHealth,
  redriveDeadOutboxRows,
  outboxRetryDelayMs,
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

  it("finishClaim dead-letters only at the attempt cap (WP-8: `dead`, not `failed`) and reports the transition", async () => {
    const atCap = await finishClaim("x", false, OUTBOX_MAX_ATTEMPTS, new Error("boom"));
    expect(atCap.becameDead).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "dead" }),
      }),
    );
    mockUpdate.mockClear();
    const early = await finishClaim("x", false, 1, new Error("boom"));
    expect(early.becameDead).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pending" }),
      }),
    );
  });

  it("attempt cap is 5 per DLQ canon", () => {
    expect(OUTBOX_MAX_ATTEMPTS).toBe(5);
  });

  it("retry backoff is capped-exponential with full jitter: [0.5x, 1.5x) of min(5min*2^(n-1), 60min)", () => {
    for (let i = 0; i < 20; i++) {
      const a1 = outboxRetryDelayMs(1);
      expect(a1).toBeGreaterThanOrEqual(2.5 * 60 * 1000);
      expect(a1).toBeLessThan(7.5 * 60 * 1000);
      const deep = outboxRetryDelayMs(10);
      expect(deep).toBeGreaterThanOrEqual(30 * 60 * 1000);
      expect(deep).toBeLessThan(90 * 60 * 1000);
    }
  });

  it("getOutboxHealth counts legacy `failed` rows as dead (same semantics, old name)", async () => {
    mockCount.mockResolvedValue(0 as never);
    mockFindFirst.mockResolvedValueOnce(null as never);
    await getOutboxHealth();
    const deadCountCall = mockCount.mock.calls.find((c) => {
      const where = (c[0] as { where?: { status?: { in?: string[] } } })?.where;
      return Array.isArray(where?.status?.in);
    });
    expect(deadCountCall).toBeTruthy();
    expect(
      (deadCountCall![0] as { where: { status: { in: string[] } } }).where.status.in.sort(),
    ).toEqual(["dead", "failed"]);
  });

  it("redrive resets dead rows to pending with attempts 0 so the drain replays them", async () => {
    mockFindMany.mockResolvedValueOnce([{ id: "d1" }, { id: "d2" }]);
    mockUpdateMany.mockResolvedValueOnce({ count: 2 });
    const n = await redriveDeadOutboxRows(50);
    expect(n).toBe(2);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["d1", "d2"] },
          status: { in: ["dead", "failed"] },
        }),
        data: expect.objectContaining({ status: "pending", attempts: 0 }),
      }),
    );
  });

  it("redrive with an empty DLQ is a no-op that never calls updateMany", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const n = await redriveDeadOutboxRows(50);
    expect(n).toBe(0);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
