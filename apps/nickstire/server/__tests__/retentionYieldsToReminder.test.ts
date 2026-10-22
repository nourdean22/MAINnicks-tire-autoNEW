/**
 * A maintenance reminder replaces the generic retention text that fortnight (decision 2026-10-22).
 * D90 and D180 consulted phonesWithReminderThisFortnight; D365 ("been about a year") did not, so a
 * 12-month brakes/cooling/electrical/suspension reminder and the D365 text could both go out within
 * about a week. Every reminder-length tier must yield; the control proves the tier still sends.
 *
 * vi.doMock per test + vi.doUnmock in afterEach: doMocks are NOT file-scoped under singleFork.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendSms = vi.fn(async () => ({ success: true, sid: "SM1" }) as Record<string, unknown>);
const reminderPhones = { set: new Set<string>() };

const DOMOCKED = [
  "../db", "../sms", "../services/featureFlags", "../services/smsInstrumentation", "../services/serviceReminders",
];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T16:00:00.000Z")); // Tue noon ET, inside retention hours
  sendSms.mockClear();
  reminderPhones.set = new Set();
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void) => {
    cb();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  vi.doMock("../services/featureFlags", () => ({ isEnabled: vi.fn(async () => true) }));
  vi.doMock("../services/smsInstrumentation", () => ({
    logOutboundSms: vi.fn(async () => undefined),
    selectVariant: (_id: number, v: Array<{ key: string; payload: unknown }>) => v[0],
  }));
  vi.doMock("../services/serviceReminders", () => ({
    phonesWithReminderThisFortnight: vi.fn(async () => reminderPhones.set),
  }));
  vi.doMock("../sms", () => ({ sendSms, withOptOut: (s: string) => s }));
  const chain = (rows: unknown[]) => ({
    from: () => ({ where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }),
  });
  let selects = 0;
  const db = {
    select: vi.fn(() => {
      selects++;
      return selects === 1
        ? chain([{ id: 9, firstName: "Pat", phone: "(216) 555-0142", vehicleYear: null, vehicleMake: null, vehicleModel: null, lastRetentionTier: null }])
        : chain([]); // no pending bookings
    }),
    update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
  };
  vi.doMock("../db", () => ({ getDb: async () => db }));
});

afterEach(() => {
  for (const m of DOMOCKED) vi.doUnmock(m);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

const TIERS = [
  ["D90", "processRetention90Day"],
  ["D180", "processRetention180Day"],
  ["D365", "processRetention365Day"],
] as const;

describe("retention tiers yield to a maintenance reminder that fortnight", () => {
  for (const [label, fn] of TIERS) {
    it(`${label}: a customer with a reminder this fortnight gets no retention text`, async () => {
      reminderPhones.set = new Set(["2165550142"]);
      const mod = await import("../cron/jobs/retentionSequences");
      await mod[fn]();
      expect(sendSms).not.toHaveBeenCalled();
    });

    it(`${label}: control, with no reminder the retention text goes out`, async () => {
      const mod = await import("../cron/jobs/retentionSequences");
      await mod[fn]();
      expect(sendSms).toHaveBeenCalledTimes(1);
    });
  }
});
