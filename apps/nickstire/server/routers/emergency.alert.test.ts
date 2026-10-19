/**
 * The emergency route itself sends Nour's Telegram (services/emergencyAlert.ts) since bdnick.info no
 * longer gets the customer's name or phone: the consumer end, through the real procedure, with every
 * send faked (no SMS, no Sheets, no Telegram leaves the test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sendEmergencyTelegram: vi.fn(),
  emergencyRequest: vi.fn(),
  sendSmsOrThrow: vi.fn(),
  syncLeadToSheet: vi.fn(),
  logIntegrationFailure: vi.fn(),
}));

vi.mock("../services/emergencyAlert", () => ({ sendEmergencyTelegram: h.sendEmergencyTelegram }));
vi.mock("../services/eventBus", () => ({ emit: { emergencyRequest: h.emergencyRequest } }));
vi.mock("../sms", () => ({ sendSmsOrThrow: h.sendSmsOrThrow }));
vi.mock("../sheets-sync", () => ({ syncLeadToSheet: h.syncLeadToSheet }));
vi.mock("../integration-failures", () => ({ logIntegrationFailure: h.logIntegrationFailure }));
vi.mock("../lib/db-helper", () => {
  const select = { from: () => select, orderBy: () => select, where: () => select, limit: async () => [{ id: 12 }] };
  return { db: async () => ({ insert: () => ({ values: async () => undefined }), select: () => select }) };
});

import { emergencyRouter } from "./emergency";
import type { TrpcContext } from "../_core/context";

const caller = () =>
  emergencyRouter.createCaller({
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext);

/** The route fires its sends without awaiting them. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

beforeEach(() => {
  for (const m of Object.values(h)) m.mockReset();
  h.sendEmergencyTelegram.mockResolvedValue(true);
  h.emergencyRequest.mockResolvedValue(undefined);
  h.sendSmsOrThrow.mockResolvedValue(undefined);
  h.syncLeadToSheet.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("emergency.submit · Nour's Telegram", () => {
  it("is sent by nickstire with the row id, the customer's name, phone and problem", async () => {
    await caller().submit({ name: "Ann Lee", phone: "216-555-0199", vehicle: "2012 Civic", problem: "Flat on I-90", urgency: "emergency" });
    await settle();
    expect(h.sendEmergencyTelegram).toHaveBeenCalledTimes(1);
    expect(h.sendEmergencyTelegram).toHaveBeenCalledWith({ emergencyId: 12, name: "Ann Lee", phone: "216-555-0199", problem: "Flat on I-90" });
    // The bus event still goes out (bridge sync/events, scrubbed on the way out).
    expect(h.emergencyRequest).toHaveBeenCalledTimes(1);
  });

  it("an alert that fails does not fail the customer's request", async () => {
    h.sendEmergencyTelegram.mockResolvedValue(false);
    await expect(
      caller().submit({ name: "Ann Lee", phone: "216-555-0199", problem: "Flat on I-90", urgency: "emergency" }),
    ).resolves.toBeTruthy();
  });
});
