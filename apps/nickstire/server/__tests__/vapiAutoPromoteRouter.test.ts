/**
 * The /admin side of the receptionist auto-promote (self-learning W3, 2026-10-31).
 *
 * Asserted through a real caller of the vapi router: the undo tap reaches the
 * same rollback the canary uses, with the production dependencies; the pause
 * switch writes what Nour chose; and a non-admin is refused before any of it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  undo: vi.fn(),
  setPaused: vi.fn(),
  status: vi.fn(),
}));
vi.mock("../services/receptionistPromotion", () => ({
  undoReceptionistPromotion: mocks.undo,
  setAutoPromotePaused: mocks.setPaused,
  readAutoPromoteStatus: mocks.status,
  productionPromotionDeps: async () => ({ production: true }),
}));

import { vapiRouter } from "../routers/vapi";
import type { TrpcContext } from "../_core/context";

function context(role: "admin" | "user"): TrpcContext {
  return {
    user: {
      id: 1,
      openId: `${role}-user`,
      email: `${role}@nickstire.com`,
      name: `${role} user`,
      loginMethod: "manus",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeEach(() => {
  mocks.undo.mockReset().mockResolvedValue({ status: "undone", reason: "operator", line: "Auto-promote: UNDONE by Nour" });
  mocks.setPaused.mockReset().mockImplementation(async (paused: boolean) => ({ paused }));
  mocks.status.mockReset().mockResolvedValue({ armed: true, paused: false, open: null, recent: [] });
});

describe("vapi auto-promote procedures", () => {
  it("undo runs the rollback with the production dependencies and returns its result", async () => {
    const r = await vapiRouter.createCaller(context("admin")).undoAutoPromotion();
    expect(mocks.undo).toHaveBeenCalledWith({ production: true });
    expect(r).toMatchObject({ status: "undone" });
  });

  it("the pause switch writes exactly what was chosen", async () => {
    await vapiRouter.createCaller(context("admin")).setAutoPromotePaused({ paused: true });
    await vapiRouter.createCaller(context("admin")).setAutoPromotePaused({ paused: false });
    expect(mocks.setPaused.mock.calls).toEqual([[true], [false]]);
  });

  it("status passes the service's answer through", async () => {
    expect(await vapiRouter.createCaller(context("admin")).autoPromoteStatus()).toEqual({ armed: true, paused: false, open: null, recent: [] });
  });

  it("a non-admin is refused before the undo or the switch runs", async () => {
    await expect(vapiRouter.createCaller(context("user")).undoAutoPromotion()).rejects.toThrow();
    await expect(vapiRouter.createCaller(context("user")).setAutoPromotePaused({ paused: true })).rejects.toThrow();
    expect(mocks.undo).not.toHaveBeenCalled();
    expect(mocks.setPaused).not.toHaveBeenCalled();
  });
});
