/**
 * recordInteraction · the one ledger seam (2026-09-16).
 *
 * Pins the contract that ended the nine-week-silent ledger: the row and BOTH
 * counters land in one transaction; lastInteraction only moves forward, by a
 * WHERE predicate rather than a pre-read; XP is credited with the PRIOR
 * timestamp (the neglect-repair bonus depends on it) and never for automatic
 * writers; the exclusive variant runs its check and write under Serializable
 * isolation and turns the loser's P2034 into `lost_race` instead of a
 * duplicate row.
 *
 * Positive controls (run before commit; the PR body carries the receipts):
 *   · drop the guarded updateMany            → "moves forward only" red
 *   · drop { isolationLevel: "Serializable" } → "exclusive variant" red
 *   · drop the count check                    → "already_logged_in_window" red
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  personFindUnique: vi.fn(),
  transaction: vi.fn(),
  txLedgerCreate: vi.fn(),
  txLedgerCount: vi.fn(),
  txPersonUpdate: vi.fn(),
  txPersonUpdateMany: vi.fn(),
  txPersonFindUniqueOrThrow: vi.fn(),
  embed: vi.fn(),
  credit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { findUnique: m.personFindUnique },
    $transaction: m.transaction,
  },
}));
vi.mock("@/lib/brain/people-embed-hook", () => ({ enqueueLedgerEmbed: m.embed }));
vi.mock("@/lib/mastery/people-credit", () => ({ creditLedgerDeposit: m.credit }));

import {
  PersonNotFoundError,
  recordInteraction,
  recordInteractionOnce,
} from "@/lib/services/people/record-interaction";

const tx = {
  relationshipLedger: { create: m.txLedgerCreate, count: m.txLedgerCount },
  personProfile: {
    update: m.txPersonUpdate,
    updateMany: m.txPersonUpdateMany,
    findUniqueOrThrow: m.txPersonFindUniqueOrThrow,
  },
};

const PRIOR = new Date("2026-09-01T10:00:00Z");
const AT = new Date("2026-09-15T18:30:00Z");
const SINCE = new Date("2026-09-15T12:00:00Z");

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.personFindUnique.mockResolvedValue({ name: "Dania", role: "friend", lastInteraction: PRIOR });
  m.transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  m.txLedgerCreate.mockResolvedValue({ id: "L1" });
  m.txPersonUpdate.mockResolvedValue({ id: "p1" });
  m.txPersonUpdateMany.mockResolvedValue({ count: 1 });
  m.txPersonFindUniqueOrThrow.mockResolvedValue({ lastInteraction: AT, interactionCount: 3 });
  m.txLedgerCount.mockResolvedValue(0);
  m.embed.mockResolvedValue(undefined);
  m.credit.mockResolvedValue(undefined);
});

describe("recordInteraction", () => {
  it("writes the row and both counters inside ONE transaction, dated `at`, and moves lastInteraction forward only", async () => {
    const out = await recordInteraction({
      personId: "p1",
      amount: 5,
      note: "coffee at the shop, talked about the move",
      source: "manual",
      at: AT,
      metadata: { via: "test" },
    });

    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.txLedgerCreate).toHaveBeenCalledWith({
      data: {
        personId: "p1",
        amount: 5,
        note: "coffee at the shop, talked about the move",
        source: "manual",
        createdAt: AT,
        metadata: { via: "test" },
      },
      select: { id: true },
    });
    expect(m.txPersonUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { interactionCount: { increment: 1 } },
      select: { id: true },
    });
    // The forward-only rule lives in the predicate, not in a pre-read.
    expect(m.txPersonUpdateMany).toHaveBeenCalledWith({
      where: { id: "p1", OR: [{ lastInteraction: null }, { lastInteraction: { lt: AT } }] },
      data: { lastInteraction: AT },
    });
    // Row first, then counters — never a bump without a row.
    expect(m.txLedgerCreate.mock.invocationCallOrder[0]).toBeLessThan(
      m.txPersonUpdate.mock.invocationCallOrder[0],
    );
    expect(out).toEqual({
      ledgerId: "L1",
      personId: "p1",
      personName: "Dania",
      amount: 5,
      note: "coffee at the shop, talked about the move",
      source: "manual",
      at: AT,
      lastInteraction: AT,
      interactionCount: 3,
    });
  });

  it("credits XP with the PRIOR lastInteraction and embeds the note, both after the commit", async () => {
    await recordInteraction({ personId: "p1", amount: 5, note: "coffee at the shop, talked", source: "manual", at: AT });
    await vi.waitFor(() => expect(m.credit).toHaveBeenCalledTimes(1));
    expect(m.credit).toHaveBeenCalledWith({
      ledgerId: "L1",
      personId: "p1",
      amount: 5,
      note: "coffee at the shop, talked",
      role: "friend",
      priorLastInteraction: PRIOR,
    });
    await vi.waitFor(() => expect(m.embed).toHaveBeenCalledWith("L1", "coffee at the shop, talked"));
  });

  it("creditXp:false (an automatic writer) still embeds but never credits", async () => {
    await recordInteraction({ personId: "p1", amount: 1, note: "walked the bays with him, talked staffing", source: "chat", creditXp: false });
    await vi.waitFor(() => expect(m.embed).toHaveBeenCalledTimes(1));
    // Give any stray credit a tick to show up before asserting its absence.
    await new Promise((r) => setTimeout(r, 5));
    expect(m.credit).not.toHaveBeenCalled();
  });

  it("clamps the amount to ±100 and truncates; a blank note or a non-finite amount is rejected before any read or write", async () => {
    await recordInteraction({ personId: "p1", amount: 250.9, note: "huge favor", source: "manual" });
    expect(m.txLedgerCreate.mock.calls[0][0].data.amount).toBe(100);

    await expect(
      recordInteraction({ personId: "p1", amount: 1, note: "   ", source: "manual" }),
    ).rejects.toThrow("note_required");
    await expect(
      recordInteraction({ personId: "p1", amount: Number.NaN, note: "x", source: "manual" }),
    ).rejects.toThrow("amount_invalid");
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.personFindUnique).toHaveBeenCalledTimes(1);
  });

  it("an unknown person throws PersonNotFoundError and opens no transaction", async () => {
    m.personFindUnique.mockResolvedValue(null);
    await expect(
      recordInteraction({ personId: "ghost", amount: 1, note: "x", source: "manual" }),
    ).rejects.toBeInstanceOf(PersonNotFoundError);
    expect(m.transaction).not.toHaveBeenCalled();
  });
});

describe("recordInteractionOnce — the exclusive variant for automatic writers", () => {
  const input = {
    personId: "p1",
    amount: 1,
    note: "walked the bays with him, talked staffing",
    source: "chat" as const,
    at: AT,
    noRowSince: SINCE,
    creditXp: false,
  };

  it("runs the window check and the write in one Serializable transaction, predicated on the person AND the window", async () => {
    const out = await recordInteractionOnce(input);
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
    expect(m.txLedgerCount).toHaveBeenCalledWith({
      where: { personId: "p1", createdAt: { gte: SINCE } },
    });
    // The count is read inside the SAME transaction as the write.
    expect(m.txLedgerCount.mock.invocationCallOrder[0]).toBeLessThan(
      m.txLedgerCreate.mock.invocationCallOrder[0],
    );
    expect(out.skipped).toBe(false);
    expect(out.recorded?.ledgerId).toBe("L1");
  });

  it("a row already inside the window (any source — a human's counts) → skipped, nothing written", async () => {
    m.txLedgerCount.mockResolvedValue(1);
    const out = await recordInteractionOnce(input);
    expect(out).toEqual({ skipped: true, reason: "already_logged_in_window", recorded: null });
    expect(m.txLedgerCreate).not.toHaveBeenCalled();
    expect(m.txPersonUpdate).not.toHaveBeenCalled();
    expect(m.txPersonUpdateMany).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5));
    expect(m.embed).not.toHaveBeenCalled();
  });

  it("the loser of the race (P2034) is reported as lost_race — never retried into a duplicate, never thrown", async () => {
    m.transaction.mockRejectedValueOnce(Object.assign(new Error("write conflict"), { code: "P2034" }));
    const out = await recordInteractionOnce(input);
    expect(out).toEqual({ skipped: true, reason: "lost_race", recorded: null });
    expect(m.transaction).toHaveBeenCalledTimes(1);
  });

  it("any other transaction failure still throws (a broken store is not a skip)", async () => {
    m.transaction.mockRejectedValueOnce(new Error("connection reset"));
    await expect(recordInteractionOnce(input)).rejects.toThrow("connection reset");
  });
});
