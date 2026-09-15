/**
 * buildBrainChangesSince · the Brain "since your last visit" read (2026-09-15).
 *
 * Pins the three claims' WHERE clauses — each is what makes the count a
 * change and not a read: new = createdAt ≥ since on live rows minus the
 * shadow channel; reinforced = lastSeen ≥ since AND createdAt < since (NOT
 * updatedAt, which recall bumps on every hit); tombstoned = deletedAt ≥
 * since with no live filter. A failed query is named, the others still
 * count. Positive control (run before commit): with `activeOnly` removed
 * from the created query the first test goes red on `deletedAt`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: { count: mocks.count } } }));

import { buildBrainChangesSince } from "@/lib/services/brain/changes-since";

const NOW = new Date("2026-09-15T20:00:00Z");
const SINCE = NOW.getTime() - 2 * 3_600_000;

beforeEach(() => {
  mocks.count.mockReset();
});

describe("buildBrainChangesSince", () => {
  it("queries the three claims with the clauses that make them changes, not reads", async () => {
    mocks.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const set = await buildBrainChangesSince(SINCE, NOW);
    expect(mocks.count).toHaveBeenCalledTimes(3);
    const [created, reinforced, tombstoned] = mocks.count.mock.calls.map((c) => (c[0] as { where: Record<string, unknown> }).where);
    expect(created).toMatchObject({ deletedAt: null, createdAt: { gte: new Date(SINCE) }, category: { notIn: ["memory_gateway_shadow"] } });
    expect(reinforced).toMatchObject({ deletedAt: null, lastSeen: { gte: new Date(SINCE) }, createdAt: { lt: new Date(SINCE) } });
    expect(reinforced).not.toHaveProperty("updatedAt");
    expect(tombstoned).toEqual({ deletedAt: { gte: new Date(SINCE) } });
    expect(set.parts).toEqual([
      { label: "new memories", count: 4 },
      { label: "reinforced", count: 2 },
      { label: "tombstoned", count: 1 },
    ]);
    expect(set.failedSources).toEqual([]);
    expect(set.clamped).toBe(false);
    expect(set.errors).toEqual({ measured: false, count: 0 });
  });

  it("a failed query is NAMED; zero counts are dropped; the others still count", async () => {
    mocks.count.mockResolvedValueOnce(0).mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(3);
    const set = await buildBrainChangesSince(SINCE, NOW);
    expect(set.parts).toEqual([{ label: "tombstoned", count: 3 }]);
    expect(set.failedSources).toEqual(["reinforced"]);
  });

  it("a month-old cursor scans 7 days and says so", async () => {
    mocks.count.mockResolvedValue(0);
    const set = await buildBrainChangesSince(NOW.getTime() - 40 * 86_400_000, NOW);
    expect(set.clamped).toBe(true);
    expect(set.since).toBe(NOW.getTime() - 7 * 86_400_000);
    const created = (mocks.count.mock.calls[0]![0] as { where: { createdAt: { gte: Date } } }).where;
    expect(created.createdAt.gte.getTime()).toBe(set.since);
  });
});
