/**
 * recordDecisionByContent · lib/services/outcome-ledger.ts (2026-08-16).
 *
 * This function is the join that closes the intelligence learning loop.
 * IntelligenceOutcome had five producers (recordShown) and ZERO consumers —
 * `recordDecision` and `recordOutcome` had no callers anywhere in the app, so
 * `decision` was NULL on every row, `outcomesNeedingReview()` always returned
 * empty, and the recall-eval corpus could never grow past synthetic seeds.
 *
 * The reason nobody called them is that none of the five producers persists
 * the returned cuid anywhere a dismiss handler could reach. The content hash
 * is indexed and deterministic, so the surfaced TEXT is enough to find the
 * row — that is what this pins.
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
  recordDecisionByContent,
  outcomeContentHash,
} from "@/lib/services/outcome-ledger";

describe("recordDecisionByContent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds the row by content hash and records the decision", async () => {
    mocks.intelligenceOutcome.findFirst.mockResolvedValueOnce({ id: "row-1" });
    mocks.intelligenceOutcome.updateMany.mockResolvedValueOnce({ count: 1 });

    const ok = await recordDecisionByContent("You have 3 stale estimates", "dismissed");

    expect(ok).toBe(true);
    const where = mocks.intelligenceOutcome.findFirst.mock.calls[0][0].where;
    expect(where.contentHash).toBe(outcomeContentHash("You have 3 stale estimates"));
    // Only rows that have NOT already been decided.
    expect(where.decision).toBeNull();
    const update = mocks.intelligenceOutcome.updateMany.mock.calls[0][0];
    expect(update.data.decision).toBe("dismissed");
    expect(update.data.decidedAt).toBeInstanceOf(Date);
  });

  it("matches the hash the producer wrote, whitespace and case aside", async () => {
    // recordShown normalizes before hashing; the dismiss side must agree or
    // the join silently misses and the loop stays open.
    expect(outcomeContentHash("  Stale   ESTIMATES  ")).toBe(
      outcomeContentHash("stale estimates"),
    );
  });

  it("returns false rather than throwing when nothing matches", async () => {
    mocks.intelligenceOutcome.findFirst.mockResolvedValueOnce(null);
    await expect(recordDecisionByContent("never shown", "dismissed")).resolves.toBe(false);
    expect(mocks.intelligenceOutcome.updateMany).not.toHaveBeenCalled();
  });

  it("ignores empty text without querying", async () => {
    await expect(recordDecisionByContent("   ", "dismissed")).resolves.toBe(false);
    expect(mocks.intelligenceOutcome.findFirst).not.toHaveBeenCalled();
  });

  it("scopes the lookup to a recent window so an old twin can't absorb it", async () => {
    mocks.intelligenceOutcome.findFirst.mockResolvedValueOnce(null);
    await recordDecisionByContent("something", "accepted");
    const where = mocks.intelligenceOutcome.findFirst.mock.calls[0][0].where;
    expect(where.shownAt.gte).toBeInstanceOf(Date);
    const ageDays = (Date.now() - where.shownAt.gte.getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(29);
    expect(ageDays).toBeLessThan(31);
  });

  it("never throws into the caller when the DB errors", async () => {
    mocks.intelligenceOutcome.findFirst.mockRejectedValueOnce(new Error("db down"));
    await expect(recordDecisionByContent("x", "dismissed")).resolves.toBe(false);
  });
});
