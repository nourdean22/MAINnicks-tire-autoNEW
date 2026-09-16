/**
 * buildPeopleChangesSince · the /people "since your last visit" read (2026-09-16).
 *
 * Pins the three claims: new people = createdAt ≥ since on LIVE rows; interactions
 * logged = ledger rows with createdAt ≥ since (every source); went overdue = an
 * active person with a cadence whose threshold (lastInteraction + cadenceDays)
 * crossed INTO the window — already-overdue people are not news. A failed query is
 * named, the others still count. Positive control (run before commit): with
 * `activeOnly` removed from the created query the first test goes red on `deletedAt`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ personCount: vi.fn(), personFindMany: vi.fn(), ledgerCount: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { count: mocks.personCount, findMany: mocks.personFindMany },
    relationshipLedger: { count: mocks.ledgerCount },
  },
}));

import { buildPeopleChangesSince, countWentOverdue } from "@/lib/services/people/changes-since";

const DAY = 86_400_000;
const NOW = new Date("2026-09-16T01:00:00Z");
const SINCE = NOW.getTime() - 2 * 3_600_000;

beforeEach(() => {
  mocks.personCount.mockReset();
  mocks.personFindMany.mockReset();
  mocks.ledgerCount.mockReset();
});

describe("buildPeopleChangesSince", () => {
  it("queries the three claims with the clauses that make them changes, not reads", async () => {
    mocks.personCount.mockResolvedValueOnce(2);
    mocks.ledgerCount.mockResolvedValueOnce(5);
    // one crossed its threshold 1h ago (inside the window), one crossed 3 days ago (before the visit)
    mocks.personFindMany.mockResolvedValueOnce([
      { lastInteraction: new Date(NOW.getTime() - 3_600_000 - 7 * DAY), cadenceDays: 7 },
      { lastInteraction: new Date(NOW.getTime() - 3 * DAY - 7 * DAY), cadenceDays: 7 },
    ]);
    const set = await buildPeopleChangesSince(SINCE, NOW);

    const created = (mocks.personCount.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(created).toMatchObject({ deletedAt: null, createdAt: { gte: new Date(SINCE) } });
    const logged = (mocks.ledgerCount.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(logged).toEqual({ createdAt: { gte: new Date(SINCE) } });
    const cadence = (mocks.personFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(cadence).toMatchObject({ deletedAt: null, status: "active", cadenceDays: { not: null }, lastInteraction: { not: null } });

    expect(set.parts).toEqual([
      { label: "new people", count: 2 },
      { label: "interactions logged", count: 5 },
      { label: "went overdue", count: 1 },
    ]);
    expect(set.failedSources).toEqual([]);
    expect(set.errors).toEqual({ measured: false, count: 0 });
    expect(set.since).toBe(SINCE);
    expect(set.clamped).toBe(false);
  });

  it("names a failed source instead of zeroing it, and keeps the other claims", async () => {
    mocks.personCount.mockRejectedValueOnce(new Error("db down"));
    mocks.ledgerCount.mockResolvedValueOnce(0);
    mocks.personFindMany.mockResolvedValueOnce([]);
    const set = await buildPeopleChangesSince(SINCE, NOW);
    expect(set.failedSources).toEqual(["new people"]);
    expect(set.parts).toEqual([]);
  });

  it("clamps a month-old cursor to the 7-day window and says so", async () => {
    mocks.personCount.mockResolvedValueOnce(0);
    mocks.ledgerCount.mockResolvedValueOnce(0);
    mocks.personFindMany.mockResolvedValueOnce([]);
    const set = await buildPeopleChangesSince(NOW.getTime() - 30 * DAY, NOW);
    expect(set.clamped).toBe(true);
    expect(set.since).toBe(NOW.getTime() - 7 * DAY);
  });
});

describe("countWentOverdue", () => {
  const since = NOW.getTime() - DAY;
  const now = NOW.getTime();
  it("counts only thresholds that fell inside (since, now]", () => {
    const rows = [
      { lastInteraction: new Date(now - 7 * DAY - 3_600_000), cadenceDays: 7 }, // due 1h ago → inside
      { lastInteraction: new Date(now - 7 * DAY - 2 * DAY), cadenceDays: 7 }, // due 2d ago → before the visit
      { lastInteraction: new Date(now - 7 * DAY + 3_600_000), cadenceDays: 7 }, // due in 1h → not yet
      { lastInteraction: new Date(now - 7 * DAY - 3_600_000), cadenceDays: null }, // no cadence → never
      { lastInteraction: null, cadenceDays: 7 }, // never interacted → no threshold
    ];
    expect(countWentOverdue(rows, since, now)).toBe(1);
  });
  it("is 0 for an empty fleet (the measured production state: no cadences set)", () => {
    expect(countWentOverdue([], since, now)).toBe(0);
  });
});
