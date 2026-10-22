/**
 * The reminder queue sends nothing unless the `service_reminders_from_invoices` lane is armed.
 * Before 2026-10-22 processReminderQueue sent every due service_reminders row with no flag at all,
 * so any row written there became a customer text. Unarmed, it runs the planner as a shadow
 * (counts only) and returns.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  armed: false,
  sendSms: vi.fn(async () => ({ success: true, sid: "SM1" })),
  sync: vi.fn(async (_db: unknown, armed: boolean) => ({ mode: armed ? "armed" : "shadow", planned: 3, byType: { tires: 3 }, inserted: 0, closed: 0 })),
  sendDue: vi.fn(async () => ({ due: 0, sent: 0, queued: 0, uncertain: 0, heldOut: 0, failed: 0, awaitingApproval: 0, deferred: 0 })),
}));

const dueRow = { id: 1, phone: "2165550106", customerName: "Pat", serviceType: "tires", nextDueDate: new Date("2026-01-01"), status: "scheduled" };

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({})),
  getReminderSettings: vi.fn(async () => []),
  upsertReminderSetting: vi.fn(),
  seedDefaultReminderSettings: vi.fn(),
  getServiceReminders: vi.fn(async () => []),
  getDueReminders: vi.fn(async () => [dueRow]),
  markReminderSent: vi.fn(),
  snoozeReminder: vi.fn(),
  getReminderStats: vi.fn(),
}));
vi.mock("../sms", () => ({ sendSms: h.sendSms, maintenanceReminderSms: () => "text" }));
vi.mock("../services/featureFlags", () => ({ isEnabled: vi.fn(async () => h.armed) }));
vi.mock("../services/serviceReminders", () => ({ syncServiceReminders: h.sync, sendDueServiceReminders: h.sendDue }));

import { processReminderQueue } from "../routers/reminders";

describe("processReminderQueue lane gate", () => {
  beforeEach(() => {
    h.sendSms.mockClear();
    h.sync.mockClear();
    h.sendDue.mockClear();
  });

  it("unarmed: a due row is NOT texted; the planner runs as a shadow", async () => {
    h.armed = false;
    await processReminderQueue();
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(h.sendDue).not.toHaveBeenCalled();
    expect(h.sync).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("armed: the planner writes and the due reminders go to the sender", async () => {
    h.armed = true;
    await processReminderQueue();
    expect(h.sync).toHaveBeenCalledWith(expect.anything(), true);
    expect(h.sendDue).toHaveBeenCalledTimes(1);
  });
});
