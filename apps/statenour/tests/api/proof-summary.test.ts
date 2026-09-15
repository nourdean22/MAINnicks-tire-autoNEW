/**
 * /proof must survive the ledger tables not existing yet (hand-applied
 * migration vs auto-deploying main). Prisma's P2021/P2022 degrade to an empty,
 * clearly-flagged summary; any other error still surfaces.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { groupBy, eventsFindMany, claimsFindMany, tasteFindMany, workFindMany } = vi.hoisted(() => ({
  groupBy: vi.fn(),
  eventsFindMany: vi.fn(),
  claimsFindMany: vi.fn(),
  tasteFindMany: vi.fn(),
  workFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    evidenceClaim: { groupBy, findMany: claimsFindMany, createMany: vi.fn() },
    realityEvent: { findMany: eventsFindMany, createMany: vi.fn() },
    tasteJudgment: { findMany: tasteFindMany, create: vi.fn() },
    brainMemory: { create: vi.fn() },
    workItem: { findMany: workFindMany },
  },
}));

const missingTable = () => Object.assign(new Error("The table `public.reality_events` does not exist in the current database."), { code: "P2021" });

beforeEach(() => {
  vi.clearAllMocks();
  groupBy.mockResolvedValue([{ grade: "H4", _count: { _all: 2 } }]);
  eventsFindMany.mockResolvedValue([]);
  claimsFindMany.mockResolvedValue([]);
  tasteFindMany.mockResolvedValue([]);
  workFindMany.mockResolvedValue([]);
});

describe("proofSummary", () => {
  it("positive control: with the tables present it reports ledgerAvailable and the counts", async () => {
    const { proofSummary } = await import("@/lib/services/reality-ledger");
    const s = await proofSummary();
    expect(s.ledgerAvailable).toBe(true);
    expect(s.byGrade.H4).toBe(2);
  });
  it("degrades to an empty, flagged summary when a ledger table is missing (P2021)", async () => {
    eventsFindMany.mockRejectedValueOnce(missingTable());
    groupBy.mockRejectedValueOnce(missingTable());
    const { proofSummary } = await import("@/lib/services/reality-ledger");
    const s = await proofSummary();
    expect(s.ledgerAvailable).toBe(false);
    expect(s.events).toEqual([]);
    expect(s.byGrade.H4).toBe(0);
  });
  it("any other database error still surfaces", async () => {
    claimsFindMany.mockRejectedValueOnce(new Error("connection reset"));
    const { proofSummary } = await import("@/lib/services/reality-ledger");
    await expect(proofSummary()).rejects.toThrow(/connection reset/);
  });
});
