/**
 * The usefulness half of the outcome ledger (2026-08-19 · outcome-loop wave).
 *
 * recordOutcome shipped 2026-07-28 with ZERO callers — outcomeUseful was
 * NULL on every row for the ledger's whole life, for the same reason
 * decisions once were: no producer persists the ledger id anywhere a
 * later outcome moment can reach. recordOutcomeByContent is the
 * contentHash bridge (the recordDecisionByContent pattern), and its
 * never-overwrite property is what makes it safe for task completion to
 * call unconditionally.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  intelligenceOutcome: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { intelligenceOutcome: mocks.intelligenceOutcome },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import {
  outcomeContentHash,
  recordOutcomeByContent,
} from "@/lib/services/outcome-ledger";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.intelligenceOutcome.findFirst.mockResolvedValue({ id: "row-1" });
  mocks.intelligenceOutcome.updateMany.mockResolvedValue({ count: 1 });
});

describe("recordOutcomeByContent", () => {
  it("joins by contentHash over a 30d window and writes outcomeUseful", async () => {
    const ok = await recordOutcomeByContent("Call the supplier about brake pads", true, "task:t1");
    expect(ok).toBe(true);

    const find = mocks.intelligenceOutcome.findFirst.mock.calls[0][0];
    expect(find.where.contentHash).toBe(outcomeContentHash("Call the supplier about brake pads"));
    expect(find.where.shownAt.gte).toBeInstanceOf(Date);
    expect(find.orderBy).toEqual({ shownAt: "desc" });

    const update = mocks.intelligenceOutcome.updateMany.mock.calls[0][0];
    expect(update.where.id).toBe("row-1");
    expect(update.data.outcomeUseful).toBe(true);
    expect(update.data.outcomeAt).toBeInstanceOf(Date);
    expect(update.data.resultRef).toBe("task:t1");
  });

  it("NEVER overwrites an earlier judgment — scoped at BOTH the find AND the update (CAS)", async () => {
    // The find filter alone would leave a TOCTOU window (two stale tabs);
    // the update-level `outcomeAt: null` is the atomic first-write-wins
    // guard, mirroring recordDecision's `decision: null` pattern.
    await recordOutcomeByContent("anything", false);
    expect(mocks.intelligenceOutcome.findFirst.mock.calls[0][0].where.outcomeAt).toBeNull();
    expect(mocks.intelligenceOutcome.updateMany.mock.calls[0][0].where.outcomeAt).toBeNull();
  });

  it("reports false when the CAS loses the race — a second writer matched zero rows", async () => {
    mocks.intelligenceOutcome.updateMany.mockResolvedValue({ count: 0 });
    const ok = await recordOutcomeByContent("anything", true);
    expect(ok).toBe(false);
  });

  it("is a documented no-op when the text was never ledgered", async () => {
    mocks.intelligenceOutcome.findFirst.mockResolvedValue(null);
    const ok = await recordOutcomeByContent("never shown anywhere", true);
    expect(ok).toBe(false);
    expect(mocks.intelligenceOutcome.updateMany).not.toHaveBeenCalled();
  });

  it("rejects empty text without touching the DB", async () => {
    const ok = await recordOutcomeByContent("   ", true);
    expect(ok).toBe(false);
    expect(mocks.intelligenceOutcome.findFirst).not.toHaveBeenCalled();
  });

  it("normalizes whitespace/case exactly like recordShown, so titles match summaries", async () => {
    // The whole loop rests on this: a suggestion ledgered as
    // "Call   THE supplier about brake pads " must be findable from the
    // task title "call the supplier about brake pads".
    expect(outcomeContentHash("Call   THE supplier about brake pads ")).toBe(
      outcomeContentHash("call the supplier about brake pads"),
    );
  });

  it("never throws into the caller — a DB failure returns false", async () => {
    mocks.intelligenceOutcome.findFirst.mockRejectedValue(new Error("db down"));
    const ok = await recordOutcomeByContent("whatever", true);
    expect(ok).toBe(false);
  });
});
