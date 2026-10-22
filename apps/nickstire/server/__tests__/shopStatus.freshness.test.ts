/**
 * getShopStatus anti-fabrication gate (feat/home-v2 Wave B).
 *
 * When the DB is unreachable, the service falls back to a time-of-day
 * job-count guess (estimateCurrentJobs). Before this wave, that invented
 * number flowed into bay counts, a wait time, and a "45-minute wait"
 * status message presented to customers as live fact — a standing-rule
 * violation ("wait est only when fresh"). These tests pin the contract:
 * fabricated fallbacks are flagged waitIsFresh=false and the message
 * stops asserting numbers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const dbMock = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("../lib/db-helper", () => dbMock);

import { getShopStatus } from "../services/shopStatus";
import { minutesSinceShopMidnight } from "../lib/timezoneAssert";

/** A fake drizzle handle whose bookings read returns `rows` and records the WHERE clause. */
function bookingsDb(rows: Array<{ stage: string }>) {
  const seen: { where?: unknown } = {};
  const handle = {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          seen.where = w;
          return Promise.resolve(rows);
        },
      }),
    }),
  };
  return { handle, seen };
}

describe("getShopStatus waitIsFresh gate", () => {
  beforeEach(() => {
    dbMock.db.mockReset();
  });

  it("flags waitIsFresh=false when the DB is unavailable (time-of-day fallback)", async () => {
    dbMock.db.mockResolvedValue(null);
    const status = await getShopStatus();
    expect(status.waitIsFresh).toBe(false);
    // The stale-path status message must not assert a wait time or bay
    // count as fact — regardless of open/closed at test runtime.
    if (status.isOpen) {
      expect(status.statusMessage).not.toMatch(/45-minute|bays? open|bays? available|All bays full/i);
      expect(status.statusMessage).toMatch(/first come, first served/i);
    }
  });

  it("flags waitIsFresh=true when the caller supplies a real active-order count", async () => {
    dbMock.db.mockResolvedValue(null); // even with no DB — the count is real
    const status = await getShopStatus(2);
    expect(status.waitIsFresh).toBe(true);
    expect(status.currentJobs).toBe(2);
  });

  it("fresh path keeps the real-number status messages", async () => {
    dbMock.db.mockResolvedValue(null);
    const status = await getShopStatus(0); // 0 active orders → all bays open
    expect(status.waitIsFresh).toBe(true);
    if (status.isOpen) {
      expect(status.statusMessage).toMatch(/bays open — walk right in/i);
    }
  });
});

// Upgrade scout 2026-10-22. Production read that day: one booking stuck in an
// active stage since 2026-04-22 and zero stage moves since, so the homepage
// badge said "OPEN · 3 BAYS FREE" every open hour. Walk-ins are tracked in
// ShopDriver, not in bookings.stage, so a quiet tracker is not an empty shop.
// Same rule Google applies to live busyness: show it only with enough recent data.
describe("getShopStatus live-tracker freshness (bookings.stage)", () => {
  const OPEN_TUESDAY_11AM_ET = new Date("2026-10-20T15:00:00Z");

  beforeEach(() => {
    dbMock.db.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(OPEN_TUESDAY_11AM_ET);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("no booking stage moved today: open, but no bay count or wait is claimed", async () => {
    const { handle } = bookingsDb([]);
    dbMock.db.mockResolvedValue(handle);
    const status = await getShopStatus();
    expect(status.isOpen).toBe(true);
    expect(status.waitIsFresh).toBe(false);
    expect(status.statusMessage).not.toMatch(/bays? open|bays? available|walk right in|All bays full|minute/i);
    expect(status.statusMessage).toMatch(/first come, first served/i);
  });

  it("a stage moved today: counts only the bookings still in an active stage", async () => {
    const { handle } = bookingsDb([{ stage: "in-progress" }, { stage: "waiting-parts" }, { stage: "ready" }]);
    dbMock.db.mockResolvedValue(handle);
    const status = await getShopStatus();
    expect(status.waitIsFresh).toBe(true);
    expect(status.currentJobs).toBe(2);
    expect(status.openBays).toBe(2);
  });

  it("the bookings read is bounded to today's shop day in SQL", async () => {
    const { handle, seen } = bookingsDb([]);
    dbMock.db.mockResolvedValue(handle);
    await getShopStatus();
    const q = new MySqlDialect().sqlToQuery(seen.where as SQL);
    expect(q.sql).toMatch(/`stageUpdatedAt` >= NOW\(\) - INTERVAL \? MINUTE/);
    expect(q.params).toContain(minutesSinceShopMidnight(OPEN_TUESDAY_11AM_ET));
  });
});
