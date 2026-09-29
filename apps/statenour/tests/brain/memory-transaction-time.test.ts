import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const events: string[] = [];
  const rootQuery = vi.fn();
  const rootExecute = vi.fn();
  const txQuery = vi.fn();
  const txExecute = vi.fn();
  const updateMany = vi.fn();
  const tx = {
    $queryRawUnsafe: txQuery,
    $executeRawUnsafe: txExecute,
    brainMemory: { updateMany },
  };
  return { events, rootQuery, rootExecute, txQuery, txExecute, updateMany, tx };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: h.rootQuery,
    $executeRawUnsafe: h.rootExecute,
    $transaction: async (fn: (tx: typeof h.tx) => unknown) => fn(h.tx),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  },
}));

import {
  ensureMemoryTransactionStart,
  resetTransactionTimeColumnCache,
  restoreMemoryAsCurrent,
  supersedeMemoryVersion,
} from "@/lib/brain/memory-transaction-time";

beforeEach(() => {
  h.events.length = 0;
  vi.clearAllMocks();
  resetTransactionTimeColumnCache();
  h.rootQuery.mockResolvedValue([{ count: 2 }]);
  h.rootExecute.mockResolvedValue(1);
  h.txQuery.mockImplementation(async () => {
    h.events.push("lock");
    return [{ id: "mem-old" }];
  });
  h.txExecute.mockImplementation(async () => {
    h.events.push("transaction-expire");
    return 1;
  });
  h.updateMany.mockImplementation(async () => {
    h.events.push("supersede");
    return { count: 1 };
  });
});

describe("Q-31 transaction-time write boundary", () => {
  it("stamps transaction expiry BEFORE the supersession flip in the same transaction", async () => {
    const out = await supersedeMemoryVersion({
      losingMemoryId: "mem-old",
      winningMemoryId: "mem-new",
      effectiveUntil: new Date("2026-08-15T00:00:00Z"),
      transactionAt: new Date("2026-09-29T12:00:00Z"),
      deprecate: true,
    });

    expect(out).toEqual({ count: 1, transactionStamped: true });
    expect(h.events).toEqual(["lock", "transaction-expire", "supersede"]);
    expect(h.txExecute.mock.calls[0][0]).toContain("transaction_expired_at");
    expect(h.updateMany.mock.calls[0][0].data).toMatchObject({
      supersededById: "mem-new",
      validUntil: new Date("2026-08-15T00:00:00Z"),
      confidence: 0.1,
      source: "deprecated_by_resolution",
    });
  });

  it("preserves the incumbent effective-time mutation before the pending columns are applied", async () => {
    h.rootQuery.mockResolvedValue([{ count: 0 }]);

    const out = await supersedeMemoryVersion({
      losingMemoryId: "mem-old",
      winningMemoryId: "mem-new",
      effectiveUntil: new Date("2026-08-15T00:00:00Z"),
    });

    expect(out).toEqual({ count: 1, transactionStamped: false });
    expect(h.txExecute).not.toHaveBeenCalled();
    expect(h.events).toEqual(["lock", "supersede"]);
  });

  it("does not expire transaction time when the loser is already superseded", async () => {
    h.txQuery.mockResolvedValue([]);

    const out = await supersedeMemoryVersion({
      losingMemoryId: "mem-old",
      winningMemoryId: "mem-new",
      effectiveUntil: new Date(),
    });

    expect(out).toEqual({ count: 0, transactionStamped: false });
    expect(h.txExecute).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("restarts transaction time before a verdict-flipped winner is made current", async () => {
    h.updateMany.mockImplementation(async () => {
      h.events.push("restore");
      return { count: 1 };
    });
    const at = new Date("2026-09-29T12:30:00Z");

    const out = await restoreMemoryAsCurrent("mem-new", "mem-old", at);

    expect(out).toEqual({ count: 1, transactionStamped: true });
    expect(h.events).toEqual(["lock", "transaction-expire", "restore"]);
    expect(h.txExecute.mock.calls[0][0]).toContain('"transaction_from_at" = $2');
    expect(h.txExecute.mock.calls[0][0]).toContain('"transaction_expired_at" = NULL');
    expect(h.updateMany.mock.calls[0][0].data).toMatchObject({
      supersededById: null,
      validUntil: null,
      lastVerifiedAt: at,
    });
  });

  it("materializes transaction start for an admitted row only when columns exist", async () => {
    expect(await ensureMemoryTransactionStart("mem-new")).toBe(true);
    expect(h.rootExecute).toHaveBeenCalledWith(
      expect.stringContaining('"transaction_from_at"'),
      "mem-new",
    );

    resetTransactionTimeColumnCache();
    h.rootQuery.mockResolvedValue([{ count: 0 }]);
    h.rootExecute.mockClear();
    expect(await ensureMemoryTransactionStart("legacy")).toBe(false);
    expect(h.rootExecute).not.toHaveBeenCalled();
  });
});
