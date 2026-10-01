/**
 * Q-23 phase 3 · `controlCenter.todayPulse` carries the promise ledger's debt.
 *
 * Asserted through the REAL procedure (assert-the-consumer): `promiseDebt()`
 * having tests proves nothing if the card's procedure never calls it. The db
 * helper hands back the three pulse rows; the ledger read is mocked so each of
 * its states can be driven.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn(), promiseDebt: vi.fn() }));

vi.mock("./lib/db-helper", () => ({
  db: async () => ({ execute: h.execute }),
  dbTyped: async () => null,
  requireDb: async () => { throw new Error("no db"); },
}));
vi.mock("./services/promiseLedger", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, promiseDebt: () => h.promiseDebt() };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: { id: 1, openId: "admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}
const admin = () => appRouter.createCaller(ctx());

beforeEach(() => {
  vi.clearAllMocks();
  h.execute
    .mockResolvedValueOnce([[{ openCount: 2, openCents: 50_000, last30: 1 }]])
    .mockResolvedValueOnce([[{ calls24h: 10, reachedTool24h: 3, abandoned24h: 1, lastCallAt: null }]])
    .mockResolvedValueOnce([[{ invoices7d: 4, revenue7dCents: 90_000, throughDate: "2026-09-29" }]]);
});

describe("controlCenter.todayPulse · obligations", () => {
  it("returns the ledger's counts beside the other three tiles", async () => {
    h.promiseDebt.mockResolvedValueOnce({ available: true, open: 4, overdue: 2, overdue4h: 1 });
    const r = await admin().controlCenter.todayPulse();
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.obligations).toEqual({ available: true, open: 4, overdue: 2, overdue4h: 1 });
    expect(h.promiseDebt).toHaveBeenCalledTimes(1);
  });

  it("an unreadable ledger rides along as unavailable; the pulse itself stays up", async () => {
    h.promiseDebt.mockResolvedValueOnce({ available: false, reason: "read failed" });
    const r = await admin().controlCenter.todayPulse();
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.obligations).toEqual({ available: false, reason: "read failed" });
    expect(r.calls.last24h).toBe(10);
  });
});
