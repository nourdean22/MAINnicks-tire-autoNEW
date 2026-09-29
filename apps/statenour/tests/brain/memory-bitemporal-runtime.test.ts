import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const db = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: db.query,
    $executeRawUnsafe: db.execute,
  },
}));

import {
  closeTransactionWindowIfAvailable,
  openTransactionWindowIfAvailable,
  resetTransactionColumnProbeForTest,
  restoreTransactionWindowIfAvailable,
  stampHistoricalTransactionWindowIfAvailable,
} from "@/lib/brain/memory-bitemporal";

describe("Q-31 transaction-time runtime bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTransactionColumnProbeForTest();
  });

  it("is a clean no-op before the operator applies the pending columns", async () => {
    db.query.mockResolvedValueOnce([{ count: 0 }]);

    await expect(
      openTransactionWindowIfAvailable("mem-1", new Date("2026-09-29T15:00:00Z")),
    ).resolves.toBe(false);

    expect(db.execute).not.toHaveBeenCalled();
  });

  it("opens a transaction window only after both columns are present", async () => {
    db.query.mockResolvedValueOnce([{ count: 2 }]);
    db.execute.mockResolvedValueOnce(1);

    const at = new Date("2026-09-29T15:00:00Z");
    await expect(openTransactionWindowIfAvailable("mem-1", at)).resolves.toBe(true);

    expect(db.execute).toHaveBeenCalledTimes(1);
    const [sql, sqlAt, id] = db.execute.mock.calls[0];
    expect(String(sql)).toContain('"transaction_from_at" = $1');
    expect(String(sql)).toContain('"transaction_expired_at" = NULL');
    expect(sqlAt).toEqual(at);
    expect(id).toBe("mem-1");
  });

  it("closes the outgoing row and returns its prior transaction start", async () => {
    const prior = new Date("2026-08-01T00:00:00Z");
    db.query
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ fromAt: prior }]);
    db.execute.mockResolvedValueOnce(1);

    const at = new Date("2026-09-29T15:00:00Z");
    await expect(closeTransactionWindowIfAvailable("mem-1", at)).resolves.toEqual({
      available: true,
      previousFromAt: prior,
    });

    const [sql, sqlAt, id] = db.execute.mock.calls[0];
    expect(String(sql)).toContain('"transaction_expired_at" = $1');
    expect(sqlAt).toEqual(at);
    expect(id).toBe("mem-1");
  });

  it("can stamp the frozen history row and compensate a failed replacement", async () => {
    db.query.mockResolvedValueOnce([{ count: 2 }]);
    db.execute.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const from = new Date("2026-08-01T00:00:00Z");
    const to = new Date("2026-09-29T15:00:00Z");
    await expect(
      stampHistoricalTransactionWindowIfAvailable("snapshot-1", from, to),
    ).resolves.toBe(true);

    await expect(
      restoreTransactionWindowIfAvailable("mem-1", from),
    ).resolves.toBe(true);

    expect(String(db.execute.mock.calls[0][0])).toContain('"transaction_expired_at" = $2');
    expect(String(db.execute.mock.calls[1][0])).toContain('"transaction_expired_at" = NULL');
  });

  it("pins the source ordering: close precedes the canonical content flip", () => {
    const src = readFileSync(
      join(process.cwd(), "lib", "brain", "memory-manager.ts"),
      "utf8",
    );
    const closeAt = src.indexOf("closeTransactionWindowIfAvailable(args.existing.id, now)");
    const updateWriteAt = src.indexOf(
      'write: () => this.reinforce(existing.id, content, { bumpConfidence: false })',
    );
    const supersedeWriteAt = src.indexOf(
      "write: () => this.reinforce(existing.id, content)",
    );

    expect(closeAt).toBeGreaterThan(-1);
    expect(updateWriteAt).toBeGreaterThan(closeAt);
    expect(supersedeWriteAt).toBeGreaterThan(closeAt);
  });
});
