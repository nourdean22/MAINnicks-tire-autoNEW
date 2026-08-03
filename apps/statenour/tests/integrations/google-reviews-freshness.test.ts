/**
 * getReviewStats must never let a frozen or unreadable cache read as current.
 *
 * Context: `fetchAndStoreReviews` is the only writer in this module and has ZERO
 * callers — grep returns two hits, both inside its own file. So the read side
 * serves whatever was last written, indefinitely. Meanwhile the chat snapshot in
 * app/api/ai/chat/alternate-paths.ts hands these numbers to the model under a
 * "reason from THESE numbers; do NOT invent figures" instruction.
 *
 * Two distinct failures are pinned here:
 *   1. An unreadable store returning zeros that look like a measurement.
 *   2. A months-old cache returning a number with no age attached.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: { findMany: (...a: unknown[]) => findMany(...a) } } }));

async function load() {
  vi.resetModules();
  return await import("@/lib/integrations/google-reviews");
}

function reviewRow(rating: number, updatedAt: Date) {
  return {
    content: JSON.stringify({
      id: `r${rating}-${updatedAt.getTime()}`,
      rating,
      text: "ok",
      author: "A",
      date: updatedAt.toISOString(),
      responded: false,
    }),
    updatedAt,
  };
}

beforeEach(() => findMany.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("getReviewStats · an unreadable store is not 'no reviews'", () => {
  it("reports ok:false rather than a zero measurement", async () => {
    findMany.mockRejectedValueOnce(new Error("connection refused"));
    const { getReviewStats } = await load();
    const s = await getReviewStats();

    expect(s.ok).toBe(false);
    expect(s.stale).toBe(true);
    // The zeros must be accompanied by text that stops them being quoted.
    expect(s.freshnessNote).toMatch(/UNREADABLE/i);
    expect(s.freshnessNote).toMatch(/not a measurement/i);
  });

  it("distinguishes unreadable from a genuinely empty store", async () => {
    findMany.mockResolvedValueOnce([]);
    const { getReviewStats } = await load();
    const s = await getReviewStats();

    expect(s.ok).toBe(true); // the read SUCCEEDED
    expect(s.total).toBe(0);
    expect(s.lastWriteAt).toBeNull();
    expect(s.freshnessNote).toMatch(/EVER been written/i);
  });
});

describe("getReviewStats · age travels with the number", () => {
  it("flags a months-old cache as stale and names the age", async () => {
    const old = new Date(Date.now() - 60 * 86_400_000);
    findMany.mockResolvedValueOnce([reviewRow(5, old), reviewRow(4, old)]);
    const { getReviewStats } = await load();
    const s = await getReviewStats();

    expect(s.ok).toBe(true);
    expect(s.total).toBe(2);
    expect(s.stale).toBe(true);
    expect(s.ageDays).toBeGreaterThanOrEqual(59);
    expect(s.freshnessNote).toMatch(/as of/i);
    expect(s.freshnessNote).toMatch(/never as current/i);
  });

  it("does NOT flag a freshly-written cache", async () => {
    // Guard against the check being so broad it cries stale on healthy data.
    const now = new Date();
    findMany.mockResolvedValueOnce([reviewRow(5, now)]);
    const { getReviewStats } = await load();
    const s = await getReviewStats();

    expect(s.stale).toBe(false);
    expect(s.ageDays).toBe(0);
    expect(s.freshnessNote).toMatch(/current/i);
  });

  it("takes the NEWEST write, not the oldest", async () => {
    const old = new Date(Date.now() - 90 * 86_400_000);
    const recent = new Date();
    findMany.mockResolvedValueOnce([reviewRow(3, old), reviewRow(5, recent)]);
    const { getReviewStats } = await load();
    const s = await getReviewStats();

    expect(s.stale).toBe(false);
    expect(s.ageDays).toBe(0);
  });

  it("still computes the real aggregates it always did", async () => {
    const now = new Date();
    findMany.mockResolvedValueOnce([reviewRow(5, now), reviewRow(3, now)]);
    const { getReviewStats } = await load();
    const s = await getReviewStats();

    expect(s.total).toBe(2);
    expect(s.average).toBe(4);
    expect(s.breakdown[5]).toBe(1);
    expect(s.breakdown[3]).toBe(1);
    expect(s.unresponded).toBe(2);
  });
});
