/**
 * Maintenance reminders from closed jobs (upgrade scout 2026-10-22).
 * Pins: the plan (latest closed job only, any later job closes earlier ones), the approved intervals,
 * the two send gates (lane flag at the caller, per-category approval by name here), and the
 * claim-before-send compare-and-swap.
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  due: [] as Array<{ id: number; phone: string; serviceType: string }>,
  sendSms: vi.fn(),
  logOutboundSms: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: vi.fn(), getDueReminders: vi.fn(async () => h.due) }));
vi.mock("../sms", () => ({ sendSms: h.sendSms }));
vi.mock("./smsInstrumentation", () => ({ logOutboundSms: h.logOutboundSms }));

import {
  SERVICE_REMINDER_PLAN,
  approvedReminderText,
  phonesWithReminderThisFortnight,
  planServiceReminders,
  sendDueServiceReminders,
  type ClosedJob,
} from "./serviceReminders";

const job = (phone: string, day: string, desc: string | null): ClosedJob => ({
  customerPhone: phone,
  customerName: "Pat Doe",
  serviceDescription: desc,
  vehicleInfo: null,
  invoiceDate: new Date(`${day}T15:00:00Z`),
});

describe("planServiceReminders", () => {
  it("plans from each customer's latest closed job, one reminder per category", () => {
    const plan = planServiceReminders(
      [
        job("(216) 555-0101", "2026-03-02", "4 tires mount and balance; front brake pads"),
        job("2165550101", "2026-03-02", "tire rotation"),
      ],
      new Date("2026-03-03T15:00:00Z"),
    );
    expect(plan.map((p) => p.serviceType).sort()).toEqual(["brakes", "tires"]);
    expect(plan.every((p) => p.phone === "2165550101")).toBe(true);
    expect(plan.find((p) => p.serviceType === "tires")!.nextDueDate.toISOString().slice(0, 10)).toBe("2026-09-02");
    expect(plan.find((p) => p.serviceType === "brakes")!.nextDueDate.toISOString().slice(0, 10)).toBe("2027-03-02");
  });

  it("a later closed job closes earlier reminders, even one with no description", () => {
    const plan = planServiceReminders([
      job("2165550102", "2026-01-10", "front brake pads and rotors"),
      job("2165550102", "2026-04-01", null),
    ]);
    expect(plan).toEqual([]);
  });

  it("skips a reminder more than 30 days past due, so no text claims the wrong time", () => {
    const now = new Date("2026-10-22T15:00:00Z");
    // Tires on 2025-10-20 were due 2026-04-20: six months late, the "about 6 months" text would be false.
    expect(planServiceReminders([job("2165550107", "2025-10-20", "tire rotation")], now)).toEqual([]);
    // Tires on 2026-04-10 are due 2026-10-10: twelve days late, still true.
    expect(planServiceReminders([job("2165550107", "2026-04-10", "tire rotation")], now)).toHaveLength(1);
  });

  it("plans nothing for blank descriptions, uncovered categories or unusable phones", () => {
    expect(planServiceReminders([job("2165550103", "2026-05-01", "")])).toEqual([]);
    expect(planServiceReminders([job("2165550103", "2026-05-01", "check engine light diagnosis")])).toEqual([]);
    expect(planServiceReminders([job("555-01", "2026-05-01", "oil change")])).toEqual([]);
  });
});

describe("SERVICE_REMINDER_PLAN", () => {
  it("carries the approved intervals in one config object", () => {
    const months = Object.fromEntries(Object.entries(SERVICE_REMINDER_PLAN).map(([k, v]) => [k, v.months]));
    expect(months).toEqual({ tires: 6, brakes: 12, oil: 4, cooling: 12, electrical: 12, suspension: 12 });
  });

  it("every text carries Nour's approval by name and his opener and closer (2026-10-22)", () => {
    for (const key of Object.keys(SERVICE_REMINDER_PLAN)) {
      expect(SERVICE_REMINDER_PLAN[key as keyof typeof SERVICE_REMINDER_PLAN].approvedBy).toBe("Nour 2026-10-22");
      const text = approvedReminderText(key)!;
      expect(text.startsWith("Hi there, this is Nick's Tire & Auto on Euclid Ave, hope you're doing good. It's been about ")).toBe(true);
      expect(text).toMatch(/Walk in any day[^.]*\. Let me know please, thanks\. \(216\) 862-0005$/);
    }
    expect(approvedReminderText("engine")).toBeNull();
  });

  it("texts state no price and no em dash, and give the shop's number", () => {
    for (const entry of Object.values(SERVICE_REMINDER_PLAN)) {
      const text = entry.text("(216) 862-0005");
      expect(text).not.toMatch(/\$|—/);
      expect(text).toContain("(216) 862-0005");
      expect(text.length).toBeLessThanOrEqual(360); // three SMS segments with the STOP footer
    }
  });
});

describe("phonesWithReminderThisFortnight", () => {
  it("never reads the database or silences retention while the lane is not armed", async () => {
    const db = new Proxy({}, { get: () => { throw new Error("db touched"); } });
    expect((await phonesWithReminderThisFortnight(db, false, ["2165550104"])).size).toBe(0);
  });
});

describe("sendDueServiceReminders", () => {
  const original = SERVICE_REMINDER_PLAN.tires.approvedBy;
  const originalBrakes = SERVICE_REMINDER_PLAN.brakes.approvedBy;
  let updates: Array<{ set: Record<string, unknown>; where: unknown }>;
  let claimRows: number;

  function fakeDb() {
    return {
      execute: async () => [[], []],
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: async (where: unknown) => {
            updates.push({ set, where });
            return [{ affectedRows: set.status === "sent" ? claimRows : 1 }];
          },
        }),
      }),
    };
  }

  beforeEach(() => {
    updates = [];
    claimRows = 1;
    h.sendSms.mockReset();
    h.logOutboundSms.mockReset();
    h.due = [{ id: 7, phone: "2165550105", serviceType: "tires" }];
  });
  afterEach(() => {
    SERVICE_REMINDER_PLAN.tires.approvedBy = original;
    SERVICE_REMINDER_PLAN.brakes.approvedBy = originalBrakes;
  });

  it("does not send a category whose text is not approved", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = null;
    const r = await sendDueServiceReminders(fakeDb());
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(r.awaitingApproval).toBe(1);
    expect(updates).toEqual([]);
  });

  it("claims the row with a compare-and-swap on id AND status before sending", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    h.sendSms.mockResolvedValue({ success: true, sid: "SM1" });
    const r = await sendDueServiceReminders(fakeDb());
    const claim = updates[0];
    expect(claim.set.status).toBe("sent");
    const q = new MySqlDialect().sqlToQuery(claim.where as SQL);
    expect(q.sql).toMatch(/`id` = \?.*`status` = \?/);
    expect(q.params).toEqual([7, "scheduled"]);
    expect(h.sendSms).toHaveBeenCalledWith("2165550105", expect.stringContaining("tire"), expect.objectContaining({ variantKey: "service_reminder_tires", skipPersist: true }));
    expect(r.sent).toBe(1);
  });

  it("a lost claim sends nothing", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    claimRows = 0;
    await sendDueServiceReminders(fakeDb());
    expect(h.sendSms).not.toHaveBeenCalled();
  });

  it("stops at the daily cap: with the shop day's quota used, nothing is claimed or sent", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    const db = { ...fakeDb(), execute: async () => [[{ n: 40 }], []] };
    const r = await sendDueServiceReminders(db);
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(r.capped).toBe(1);
  });

  it("cancels a row more than 30 days past due instead of sending it", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    h.due = [{ id: 8, phone: "2165550108", serviceType: "tires", nextDueDate: new Date(Date.now() - 45 * 86_400_000) } as never];
    const r = await sendDueServiceReminders(fakeDb());
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(updates[0].set.status).toBe("cancelled");
    expect(r.tooLate).toBe(1);
  });

  it("one customer gets one reminder a run: a second category due the same day is deferred", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    (SERVICE_REMINDER_PLAN.brakes as { approvedBy: string | null }).approvedBy = "test";
    h.due = [
      { id: 7, phone: "2165550105", serviceType: "tires" },
      { id: 9, phone: "2165550105", serviceType: "brakes" },
    ];
    h.sendSms.mockResolvedValue({ success: true, sid: "SM1" });
    const r = await sendDueServiceReminders(fakeDb());
    expect(h.sendSms).toHaveBeenCalledTimes(1);
    expect(r.deferred).toBe(1);
  });

  it("a reminder already sent in the last 7 days defers the next one", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    h.sendSms.mockResolvedValue({ success: true, sid: "SM1" });
    const db = {
      ...fakeDb(),
      // Only the "reminded this week" read names the phone; every other read is empty.
      execute: async (q: unknown) => {
        const s = new MySqlDialect().sqlToQuery(q as SQL).sql;
        return /FROM service_reminders\s+WHERE status = 'sent' AND sentAt >= NOW\(\) - INTERVAL 7 DAY/.test(s) ? [[{ p: "2165550105" }], []] : [[], []];
      },
    };
    const r = await sendDueServiceReminders(db);
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(r.deferred).toBe(1);
  });

  it("a number that cannot take texts does not use up the day's slots", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    h.due = Array.from({ length: 41 }, (_, i) => ({ id: 100 + i, phone: `21655${String(i).padStart(5, "0")}`, serviceType: "tires" }));
    h.sendSms.mockImplementation(async (phone: string) =>
      phone === "2165500040" ? { success: true, sid: "SM41" } : { success: false, error: "landline" },
    );
    const r = await sendDueServiceReminders(fakeDb());
    expect(h.sendSms).toHaveBeenCalledTimes(41);
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(40);
  });

  it("a definite send failure gives the row back for the next run", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    h.sendSms.mockResolvedValue({ success: false, error: "gateway down" });
    const r = await sendDueServiceReminders(fakeDb());
    expect(r.failed).toBe(1);
    expect(updates[1].set.status).toBe("scheduled");
  });
});
