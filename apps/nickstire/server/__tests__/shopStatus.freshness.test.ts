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
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("../lib/db-helper", () => dbMock);

import { getShopStatus } from "../services/shopStatus";

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
