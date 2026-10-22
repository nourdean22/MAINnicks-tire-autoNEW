import { describe, it, expect, vi, beforeEach } from "vitest";
import { processScheduledSms } from "../services/sms-scheduler";
import { getDb } from "../db";
import { isShopGatewayReachable } from "../sms";
import { orchestrateSms } from "../services/smsOrchestrator";

// 2026-10-22 (vitest 4): this file used to mock "../services/db" and "../services/smsGateway",
// two modules that do not exist. Vitest 3 let a factory mock stand in for a missing path, so the
// mocks never reached sms-scheduler.ts (it imports "../db" and "../sms"): the real getDb ran, and
// with no database it returned early, so the old "CAS lost race" assertions passed without the
// drain ever running. On a machine whose DATABASE_URL names production it would have queried
// production. The mocks below name the modules the scheduler really imports.
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../sms", () => ({
  sendSms: vi.fn(),
  isShopGatewayReachable: vi.fn(),
  appointmentReminder24hSms: vi.fn(),
  appointmentReminder1hSms: vi.fn(),
  thankYouSms: vi.fn(),
  reviewRequestSms: vi.fn(),
  maintenanceReminderSms: vi.fn(),
  bookingConfirmationRequestSms: vi.fn(),
}));
vi.mock("../services/smsOrchestrator", () => ({ orchestrateSms: vi.fn() }));
vi.mock("../services/featureFlags", () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));

function fakeDb() {
  const where = vi.fn().mockResolvedValue([{ affectedRows: 0 }]);
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where })) }));
  const limit = vi.fn().mockResolvedValue([]);
  const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) }));
  return { update, select };
}

describe("processScheduledSms · holds instead of losing reminders", () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset();
    vi.mocked(isShopGatewayReachable).mockReset();
    vi.mocked(orchestrateSms).mockReset();
  });

  it("no database: drains nothing", async () => {
    vi.mocked(getDb).mockResolvedValue(null as never);
    await expect(processScheduledSms()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(isShopGatewayReachable).not.toHaveBeenCalled();
  });

  it("gateway offline: claims nothing and sends nothing", async () => {
    const db = fakeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(isShopGatewayReachable).mockResolvedValue(false);
    await expect(processScheduledSms()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(orchestrateSms).not.toHaveBeenCalled();
  });

  it("positive control: gateway online reaches the claim and the due-row read", async () => {
    const db = fakeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(isShopGatewayReachable).mockResolvedValue(true);
    await expect(processScheduledSms()).resolves.toEqual({ sent: 0, failed: 0 });
    // The drain ran against THIS fake db: the mocked getDb handed it over, and the claim
    // and the due-row read both landed on it (no real connection can exist under this mock).
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalled();
    expect(db.select).toHaveBeenCalled();
    expect(orchestrateSms).not.toHaveBeenCalled();
  });

  it.todo(
    "lost race on the pending->processing claim sends nothing (the old CAS test modelled a per-row affectedRows check the drain no longer has; rewrite it against the current claim)",
  );
});
