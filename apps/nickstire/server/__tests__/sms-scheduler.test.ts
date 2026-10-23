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
// Inspectable predicates, so the per-row claim's WHERE can be checked field by field.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...parts: unknown[]) => ({ op: "and", parts }),
  lte: (col: unknown, val: unknown) => ({ op: "lte", col, val }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
}));

type Pred = { op: string; col?: unknown; val?: unknown; parts?: Pred[] };

/**
 * A db that walks the drain down to the per-row claim: one due 24h reminder and its booking.
 * Every update records its set + where; the claim (set status "sent") reports `claimRows`
 * affected rows, every other update 1.
 */
function dbWithDueReminder(claimRows: number) {
  const updates: Array<{ set: Record<string, unknown>; where: Pred }> = [];
  const update = vi.fn(() => ({
    set: (set: Record<string, unknown>) => ({
      where: async (where: Pred) => {
        updates.push({ set, where });
        return [{ affectedRows: set.status === "sent" ? claimRows : 1 }];
      },
    }),
  }));
  const rows = [
    [{ id: 7, bookingId: 100, type: "24h-before", status: "processing" }],
    [{ id: 100, phone: "2165550100", name: "Test", status: "scheduled", service: "Oil change", vehicleYear: "2020" }],
  ];
  const select = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => rows.shift() ?? [] }) }),
  }));
  return { db: { update, select }, updates };
}

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

  it("lost race: when the per-row claim changes no row, the reminder is not sent", async () => {
    const { db, updates } = dbWithDueReminder(0);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(isShopGatewayReachable).mockResolvedValue(true);
    // A real send result, so a broken claim fails on the send itself, not on a crash.
    vi.mocked(orchestrateSms).mockResolvedValue({ status: "sent", id: 9 } as never);
    await expect(processScheduledSms()).resolves.toEqual({ sent: 0, failed: 0 });
    expect(orchestrateSms).not.toHaveBeenCalled();
    expect(updates.filter((u) => u.set.status === "sent")).toHaveLength(1);
  });

  it("the per-row claim is a compare-and-swap on this reminder's id AND status processing", async () => {
    const { appointmentReminders } = await import("../../drizzle/schema");
    const { db, updates } = dbWithDueReminder(0);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(isShopGatewayReachable).mockResolvedValue(true);
    // A real send result, so a broken claim fails on the send itself, not on a crash.
    vi.mocked(orchestrateSms).mockResolvedValue({ status: "sent", id: 9 } as never);
    await processScheduledSms();
    const claim = updates.find((u) => u.set.status === "sent");
    expect(claim, "the drain never reached the per-row claim").toBeDefined();
    const parts = claim!.where.op === "and" ? claim!.where.parts! : [claim!.where];
    expect(parts).toContainEqual({ op: "eq", col: appointmentReminders.id, val: 7 });
    expect(parts).toContainEqual({ op: "eq", col: appointmentReminders.status, val: "processing" });
  });

  it("positive control: when the claim wins, the reminder is sent exactly once", async () => {
    const { db } = dbWithDueReminder(1);
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(isShopGatewayReachable).mockResolvedValue(true);
    vi.mocked(orchestrateSms).mockResolvedValue({ status: "sent", id: 9 } as never);
    await expect(processScheduledSms()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(orchestrateSms).toHaveBeenCalledTimes(1);
  });
});
