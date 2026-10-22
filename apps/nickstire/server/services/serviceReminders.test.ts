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

import { invoices } from "../../drizzle/schema";
import {
  COMBINED_REMINDER,
  SERVICE_REMINDER_PLAN,
  approvedReminderText,
  phonesWithReminderThisFortnight,
  planServiceReminders,
  sendDueServiceReminders,
  syncServiceReminders,
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

  it("a filter or a mount is not an oil change or a tire rotation (prod lines, 2026-10-22)", () => {
    const now = new Date("2026-10-22T15:00:00Z");
    const cats = (desc: string) => planServiceReminders([job("2165550109", "2026-10-01", desc)], now).map((p) => p.serviceType);
    for (const desc of [
      "Engine air filter",
      "Cabin air filter",
      "Fuel filter",
      "CHANGE TRANSMISSION FLUID & FILTER",
      "REMOVE & REPLACE CABIN AIR FILTER",
    ]) expect(cats(desc), desc).not.toContain("oil");
    for (const desc of [
      "motor mount",
      "transmission mount",
      "REMOVE & REPLACE ENGINE MOUNTS (BOTH)",
      "REMOVE & REPLACE ENGINE MOUNT (FRONT)",
      "Auto Labor Guide: 2004 MERCURY MOUNTAINEER",
    ]) expect(cats(desc), desc).not.toContain("tires");
    // Positive control: the real oil and tire jobs still plan.
    for (const desc of ["OIL CHANGE", "LUBE OIL & FILTER", "OIL & FILTER CHANGE", "synthetic oil and filter"]) expect(cats(desc), desc).toContain("oil");
    for (const desc of ["MOUNT & BALANCE 4 TIRES", "4 WHEEL ALIGNMENT", "tire rotation", "wheel balance"]) expect(cats(desc), desc).toContain("tires");
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

describe("COMBINED_REMINDER", () => {
  it("carries Nour's approval and his wording, with the categories in the customer's words (2026-10-22)", () => {
    expect(COMBINED_REMINDER.approvedBy).toBe("Nour 2026-10-22");
    expect(COMBINED_REMINDER.text(["suspension", "electrical", "brakes"], "(216) 862-0005")).toBe(
      "Hi there, this is Nick's Tire & Auto on Euclid Ave, hope you're doing good. Your brake, suspension and battery work with us is due for a look, all around the same time, so one visit covers it. Walk in any day, first come, first served. Let me know please, thanks. (216) 862-0005",
    );
    expect(COMBINED_REMINDER.text(["oil", "tires"], "P")).toContain("Your tire and oil change work with us");
    const all = COMBINED_REMINDER.text(Object.keys(SERVICE_REMINDER_PLAN) as never, "(216) 862-0005");
    expect(all).toContain("Your brake, tire, suspension, battery, cooling and oil change work");
    expect(all).not.toMatch(/\$|—/);
    expect(all.length).toBeLessThanOrEqual(360); // three SMS segments with the STOP footer, like the single texts
  });
});

describe("syncServiceReminders", () => {
  it("a second sync that read the table before the first one wrote neither throws nor stores a second row", async () => {
    const stored: Array<Record<string, unknown>> = [];
    const key = (r: Record<string, unknown>) => `${r.phone}|${r.serviceType}|${(r.lastServiceDate as Date).getTime()}`;
    const jobs = [job("2165550111", "2026-10-01", "front brake pads")];
    const db = {
      // Both runs read an empty service_reminders table (they overlapped), the unique key decides.
      select: () => ({ from: (t: unknown) => (t === invoices ? { where: async () => jobs } : Promise.resolve([])) }),
      // The unique key: a duplicate raises ER_DUP_ENTRY unless the insert is INSERT IGNORE, which skips it.
      insert: () => {
        let ignore = false;
        const api = {
          ignore: () => { ignore = true; return api; },
          values: async (rows: Array<Record<string, unknown>>) => {
            let affectedRows = 0;
            for (const row of rows) {
              if (stored.some((s) => key(s) === key(row))) {
                if (ignore) continue;
                throw Object.assign(new Error("Duplicate entry for key 'uq_service_reminders_phone_type_date'"), { code: "ER_DUP_ENTRY", errno: 1062 });
              }
              stored.push(row);
              affectedRows++;
            }
            return [{ affectedRows }];
          },
        };
        return api;
      },
    };
    const first = await syncServiceReminders(db, true);
    const second = await syncServiceReminders(db, true);
    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    expect(stored).toHaveLength(1);
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
  const originalCombined = COMBINED_REMINDER.approvedBy;
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
    COMBINED_REMINDER.approvedBy = originalCombined;
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

  it("no daily limit: every due, approved reminder sends on the run it comes due (Nour, 2026-10-22)", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    h.due = Array.from({ length: 45 }, (_, i) => ({ id: 200 + i, phone: `21677${String(i).padStart(5, "0")}`, serviceType: "tires" }));
    h.sendSms.mockResolvedValue({ success: true, sid: "SM" });
    const r = await sendDueServiceReminders(fakeDb());
    expect(h.sendSms).toHaveBeenCalledTimes(45);
    expect(r.sent).toBe(45);
  });

  it("cancels a row more than 30 days past due instead of sending it", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    h.due = [{ id: 8, phone: "2165550108", serviceType: "tires", nextDueDate: new Date(Date.now() - 45 * 86_400_000) } as never];
    const r = await sendDueServiceReminders(fakeDb());
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(updates[0].set.status).toBe("cancelled");
    expect(r.tooLate).toBe(1);
  });

  it("several reminders due for one customer within 30 days: one combined text, every row marked sent with its sid", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    (SERVICE_REMINDER_PLAN.brakes as { approvedBy: string | null }).approvedBy = "test";
    const now = Date.now();
    h.due = [
      { id: 7, phone: "2165550105", serviceType: "brakes", nextDueDate: new Date(now - 20 * 86_400_000) },
      { id: 9, phone: "2165550105", serviceType: "tires", nextDueDate: new Date(now - 2 * 86_400_000) },
    ] as never;
    h.sendSms.mockResolvedValue({ success: true, sid: "SM1" });
    const r = await sendDueServiceReminders(fakeDb());
    expect(h.sendSms).toHaveBeenCalledTimes(1);
    expect(h.sendSms).toHaveBeenCalledWith("2165550105", expect.stringContaining("Your brake and tire work with us is due for a look"), expect.objectContaining({ variantKey: "service_reminder_combined" }));
    expect(r).toMatchObject({ sent: 1, deferred: 0, failed: 0 });
    const claimed = updates.filter((u) => u.set.status === "sent").map((u) => new MySqlDialect().sqlToQuery(u.where as SQL).params);
    expect(claimed).toEqual([[7, "scheduled"], [9, "scheduled"]]);
    const sid = updates.find((u) => u.set.twilioSid === "SM1")!;
    expect(new MySqlDialect().sqlToQuery(sid.where as SQL).params).toEqual([7, 9]);
  });

  it("the combined text waits for approval: nothing sent, rows untouched, counted as awaiting approval", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    (SERVICE_REMINDER_PLAN.brakes as { approvedBy: string | null }).approvedBy = "test";
    (COMBINED_REMINDER as { approvedBy: string | null }).approvedBy = null;
    h.due = [
      { id: 7, phone: "2165550105", serviceType: "tires" },
      { id: 9, phone: "2165550105", serviceType: "brakes" },
    ];
    const r = await sendDueServiceReminders(fakeDb());
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(r.awaitingApproval).toBe(2);
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

  it("two reminders due 45 days apart are not combined: the second is held back and sends once the 7 days pass", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    (SERVICE_REMINDER_PLAN.brakes as { approvedBy: string | null }).approvedBy = "test";
    h.sendSms.mockResolvedValue({ success: true, sid: "SM1" });
    const dueDay = new Date("2026-10-22T15:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Run 1: tires goes out, brakes (due 45 days later) is held back and left untouched.
      vi.setSystemTime(dueDay);
      const brakesDue = new Date(dueDay.getTime() + 45 * 86_400_000);
      h.due = [
        { id: 7, phone: "2165550105", serviceType: "tires", nextDueDate: dueDay },
        { id: 9, phone: "2165550105", serviceType: "brakes", nextDueDate: brakesDue },
      ] as never;
      const first = await sendDueServiceReminders(fakeDb());
      expect(first.sent).toBe(1);
      expect(first.deferred).toBe(1);
      expect(updates.some((u) => new MySqlDialect().sqlToQuery(u.where as SQL).params.includes(9))).toBe(false);

      // Run 2, eight days later: the 7-day read no longer names the phone, so brakes sends.
      updates = [];
      h.sendSms.mockClear();
      vi.setSystemTime(new Date(dueDay.getTime() + 8 * 86_400_000));
      h.due = [{ id: 9, phone: "2165550105", serviceType: "brakes", nextDueDate: brakesDue }] as never;
      const second = await sendDueServiceReminders(fakeDb());
      expect(second.sent).toBe(1);
      expect(second.tooLate).toBe(0);
      expect(h.sendSms).toHaveBeenCalledWith("2165550105", expect.stringContaining("brake"), expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  it("a definite send failure gives the row back for the next run", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    h.sendSms.mockResolvedValue({ success: false, error: "gateway down" });
    const r = await sendDueServiceReminders(fakeDb());
    expect(r.failed).toBe(1);
    expect(updates[1].set.status).toBe("scheduled");
  });

  it("a permanent refusal (opted out, blocked, internal line, bad number) cancels the row instead of retrying it every run", async () => {
    (SERVICE_REMINDER_PLAN.tires as { approvedBy: string | null }).approvedBy = "test";
    h.sendSms.mockResolvedValue({ success: false, error: "Customer opted out of SMS" });
    const r = await sendDueServiceReminders(fakeDb());
    expect(r.failed).toBe(1);
    expect(updates[1].set).toMatchObject({ status: "cancelled", sentAt: null, errorMessage: "Customer opted out of SMS" });
    const q = new MySqlDialect().sqlToQuery(updates[1].where as SQL);
    expect(q.params).toEqual([7, "sent"]); // only the row this run claimed
  });
});
