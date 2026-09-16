/**
 * deleteLedgerRow · the delete side of the ledger seam (2026-09-16, W6).
 *
 * task.deleteLedger used to delete the row and decrement interactionCount
 * unconditionally — a deleted synthetic or status-flip row took a real
 * contact off the count, and lastInteraction was never refreshed ("not
 * worth a full scan"). Now: per-person advisory lock → delete → recompute
 * BOTH counters from the remaining contact rows with the same formula the
 * reconcile uses.
 *
 * Positive control: with the recompute replaced by `decrement: 1`, the
 * status-flip case and the "newer synthetic row" case go red.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  ledgerFindUnique: vi.fn(),
  transaction: vi.fn(),
  txExecuteRaw: vi.fn(),
  txLedgerDelete: vi.fn(),
  txLedgerFindMany: vi.fn(),
  txPersonUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    relationshipLedger: { findUnique: m.ledgerFindUnique },
    $transaction: m.transaction,
  },
}));

import { LedgerRowNotFoundError, deleteLedgerRow } from "@/lib/services/people/delete-ledger-row";

const tx = {
  $executeRaw: m.txExecuteRaw,
  relationshipLedger: { delete: m.txLedgerDelete, findMany: m.txLedgerFindMany },
  personProfile: { update: m.txPersonUpdate },
};

const d = (iso: string) => new Date(iso);

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  m.txExecuteRaw.mockResolvedValue(1);
  m.txLedgerDelete.mockResolvedValue({ id: "L1" });
  m.txPersonUpdate.mockResolvedValue({ id: "p1" });
});

describe("deleteLedgerRow", () => {
  it("locks the person FIRST, deletes, then recomputes both counters from the remaining CONTACT rows", async () => {
    m.ledgerFindUnique.mockResolvedValue({ personId: "p1", metadata: null });
    m.txLedgerFindMany.mockResolvedValue([
      { createdAt: d("2026-06-01T14:16:48Z"), metadata: null },
      { createdAt: d("2026-08-01T00:00:00Z"), metadata: { synthetic: true } }, // newer, but a mention
    ]);

    const out = await deleteLedgerRow("L1");

    const lock = m.txExecuteRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(lock[0].join("?")).toContain("pg_advisory_xact_lock(hashtext(?))");
    expect(lock.slice(1)).toEqual(["relationship_ledger:p1"]);
    expect(m.txExecuteRaw.mock.invocationCallOrder[0]).toBeLessThan(m.txLedgerDelete.mock.invocationCallOrder[0]);
    expect(m.txLedgerDelete).toHaveBeenCalledWith({ where: { id: "L1" } });
    expect(m.txLedgerFindMany).toHaveBeenCalledWith({
      where: { personId: "p1" },
      select: { createdAt: true, metadata: true },
    });
    expect(m.txPersonUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { interactionCount: 1, lastInteraction: d("2026-06-01T14:16:48Z") },
      select: { id: true },
    });
    expect(out).toEqual({
      ledgerId: "L1",
      personId: "p1",
      wasContact: true,
      interactionCount: 1,
      lastInteraction: d("2026-06-01T14:16:48Z"),
    });
  });

  it("deleting the only contact row lands on 0 / null — lastInteraction moves BACK, unlike the seam", async () => {
    m.ledgerFindUnique.mockResolvedValue({ personId: "p1", metadata: { via: "nick_action" } });
    m.txLedgerFindMany.mockResolvedValue([]);
    const out = await deleteLedgerRow("L1");
    expect(m.txPersonUpdate.mock.calls[0][0].data).toEqual({ interactionCount: 0, lastInteraction: null });
    expect(out.wasContact).toBe(true);
  });

  it("deleting a status-flip audit row never costs a contact: count stays what the contact rows say", async () => {
    m.ledgerFindUnique.mockResolvedValue({ personId: "p1", metadata: { kind: "status_flip", before: "active", after: "cooling" } });
    m.txLedgerFindMany.mockResolvedValue([
      { createdAt: d("2026-06-01T14:16:48Z"), metadata: null },
      { createdAt: d("2026-06-04T01:13:03Z"), metadata: null },
    ]);
    const out = await deleteLedgerRow("L9");
    expect(out.wasContact).toBe(false);
    expect(m.txPersonUpdate.mock.calls[0][0].data).toEqual({
      interactionCount: 2,
      lastInteraction: d("2026-06-04T01:13:03Z"),
    });
  });

  it("an unknown id throws LedgerRowNotFoundError and opens no transaction", async () => {
    m.ledgerFindUnique.mockResolvedValue(null);
    await expect(deleteLedgerRow("ghost")).rejects.toBeInstanceOf(LedgerRowNotFoundError);
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
