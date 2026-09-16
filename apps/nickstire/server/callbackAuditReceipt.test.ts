/**
 * callback.updateStatus must leave a server-side audit receipt.
 *
 * Why this file exists (2026-09-16). Three mutations back the Today action
 * queue. `booking.updateStatus` logs `booking.status_changed` server-side and
 * `lead.update` logs its own — but `callback.updateStatus` logged NOTHING. Its
 * only receipt was a SECOND, separate request the client fires afterwards
 * (`adminSecurity.recordAction`, via OverviewSection.logReceipt), so the
 * sequence was:
 *
 *   await callbackUpdate.mutateAsync(...)   // reality changes here
 *   await logReceipt(...)                   // receipt written here, or not
 *
 * An operator on a phone that drops signal between those two calls resolved a
 * real callback in production with zero audit rows, and saw an error toast for
 * an action that had in fact succeeded. Both audit writers insert into the same
 * `auditLog` table, so the fix is a server-side row like its two siblings have.
 *
 * These assert BEHAVIOUR, not the presence of a call: deleting the
 * `logAdminAction` block in callback.ts turns the first test red, and making
 * it `await`ed-and-unguarded turns the third red.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// vi.mock factories are hoisted above module scope, so the doubles have to be
// created inside vi.hoisted or the factory closes over an uninitialised const.
const { logAdminAction, updateCallbackStatus, dispatch } = vi.hoisted(() => ({
  logAdminAction: vi.fn<(arg: Record<string, unknown>) => Promise<void>>(() => Promise.resolve()),
  updateCallbackStatus: vi.fn(() => Promise.resolve({ id: 7, status: "called" })),
  dispatch: vi.fn(() => Promise.resolve()),
}));

vi.mock("./services/auditTrail", () => ({ logAdminAction }));
vi.mock("./services/eventBus", () => ({ dispatch }));
// db() === null makes the linked-lead hygiene block return without touching a
// database; that path is covered elsewhere and is not what this file pins.
vi.mock("./lib/db-helper", () => ({ db: () => Promise.resolve(null) }));
/**
 * Spread the REAL ./db and replace exactly one function. A hand-written object
 * here would drop `getDb`, which server/services/adminSecurity.ts imports
 * through the adminProcedure chain — that failure mode cost a run already, and
 * a partial db mock is the specific hazard apps/nickstire/AGENTS.md §3 names.
 */
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, updateCallbackStatus };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function adminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@nickstire.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("callback.updateStatus — server-side audit receipt", () => {
  beforeEach(() => {
    logAdminAction.mockClear();
    updateCallbackStatus.mockClear();
    dispatch.mockClear();
    logAdminAction.mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes one audit row naming the callback and its new status", async () => {
    const caller = appRouter.createCaller(adminContext());
    await caller.callback.updateStatus({ id: 7, status: "called" });

    expect(logAdminAction).toHaveBeenCalledTimes(1);
    expect(logAdminAction.mock.calls[0][0]).toMatchObject({
      action: "callback.status_changed",
      entityType: "callback",
      entityId: 7,
      newValue: "called",
    });
  });

  it("records the status the operator actually set, not a fixed one", async () => {
    const caller = appRouter.createCaller(adminContext());
    await caller.callback.updateStatus({ id: 41, status: "completed" });

    expect(logAdminAction.mock.calls[0][0]).toMatchObject({ entityId: 41, newValue: "completed" });
  });

  it("a failing audit write never blocks the status change", async () => {
    // The receipt is fire-and-forget on purpose (matching booking.ts): the
    // customer is waiting on the status change, not on the audit row. If this
    // ever becomes an awaited, unguarded call, an auditLog outage would start
    // failing real callback resolutions — so pin it.
    logAdminAction.mockImplementation(() => Promise.reject(new Error("auditLog unreachable")));

    const caller = appRouter.createCaller(adminContext());
    await expect(caller.callback.updateStatus({ id: 9, status: "no-answer" })).resolves.toBeDefined();
    expect(updateCallbackStatus).toHaveBeenCalledWith(9, "no-answer", undefined);
  });

  it("the status change is what persists — the audit row is additional, not a substitute", async () => {
    const caller = appRouter.createCaller(adminContext());
    await caller.callback.updateStatus({ id: 12, status: "called", notes: "left voicemail" });

    expect(updateCallbackStatus).toHaveBeenCalledWith(12, "called", "left voicemail");
    expect(logAdminAction).toHaveBeenCalledTimes(1);
  });
});
