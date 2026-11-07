/**
 * "Daily: 0 bookings, 0 leads" texts nobody acts on (2026-11-07 audit). Mute the SMS
 * when both counts are a confirmed zero; keep the Telegram summary and the log.
 * A failed lead read is UNKNOWN, not zero, so the text still goes out.
 * Wednesday 2026-11-04 19:30 America/New_York (after the 18:00 gate).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sms: [] as string[],
  telegram: [] as Array<Record<string, unknown>>,
  textOnDutyManager: vi.fn(async () => ({ status: "sent" })),
  bookings: 0,
  leadRows: [] as Array<Record<string, unknown>>,
  leadsThrow: false,
}));

vi.mock("../../sms", () => ({ sendSms: async (_to: string, body: string) => { h.sms.push(body); return { success: true }; } }));
vi.mock("../../services/telegram", () => ({ sendDailySummary: async (s: Record<string, unknown>) => { h.telegram.push(s); } }));
vi.mock("../../services/nickIntelligence", () => ({ getShopPulse: async () => ({ today: { revenue: 0 } }) }));
vi.mock("../../services/eventBus", () => ({ textOnDutyManager: h.textOnDutyManager }));
vi.mock("../../db", () => ({
  getDb: async () => ({
    execute: async (q: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(q?.queryChunks ?? "");
      if (text.includes("FROM bookings")) return [[{ cnt: h.bookings }], []];
      if (h.leadsThrow) throw new Error("ER_CON_COUNT_ERROR");
      return [h.leadRows, []];
    },
  }),
}));

import { generateDailyReport } from "./dailyReport";

const ORIGINAL_OWNER = process.env.OWNER_PHONE_NUMBER;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T19:30:00-05:00"));
  process.env.OWNER_PHONE_NUMBER = "+12165550100";
  h.sms = [];
  h.telegram = [];
  h.textOnDutyManager.mockClear();
  h.bookings = 0;
  h.leadRows = [];
  h.leadsThrow = false;
});
afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_OWNER === undefined) delete process.env.OWNER_PHONE_NUMBER;
  else process.env.OWNER_PHONE_NUMBER = ORIGINAL_OWNER;
});

describe("daily report SMS mute", () => {
  it("positive control: a day with a booking sends the text", async () => {
    h.bookings = 1;
    await generateDailyReport();
    expect(h.sms).toHaveLength(1);
    expect(h.sms[0]).toMatch(/^Daily: 1 bookings, 0 leads/);
  });

  it("0 bookings and 0 leads: no SMS, Telegram summary still sent", async () => {
    const out = await generateDailyReport();
    expect(h.sms).toEqual([]);
    expect(h.telegram).toEqual([expect.objectContaining({ bookings: 0, leads: 0 })]);
    expect(out.details).toContain("sms muted (0 bookings, 0 leads)");
  });

  it("a lead reached the shop: the text goes out", async () => {
    h.leadRows = [{ source: "voice", callbackId: null }];
    await generateDailyReport();
    expect(h.sms).toHaveLength(1);
  });

  it("the lead read failed: unknown is not zero, the text goes out", async () => {
    h.leadsThrow = true;
    await generateDailyReport();
    expect(h.sms).toHaveLength(1);
  });

  it("the COMING IN path is untouched: the daily report never texts the on-duty manager", async () => {
    await generateDailyReport();
    h.bookings = 2;
    await generateDailyReport();
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
  });
});
