/**
 * The two revenue rules ask nickstire's `revenue_range` for the days they mean.
 *
 * `revenue_range` takes `from` / `to` as shop-local days, both inclusive
 * (apps/nickstire/server/routes/nour-os-query.ts, shopDayRange). Both rules sent
 * `since` / `until`, which the handler never read, so each got TODAY:
 *   - friday_revenue_check projected the month from one part-day at 2pm and
 *     sent "behind pace" nearly every Friday;
 *   - revenue_overconfidence_gate read this morning's near-zero and never fired.
 * And a body without a numeric total (`{ error: "No DB" }` answers 200) read as $0.
 *
 * Driven through the REAL triggers (`__ruleTriggerForTest`), mocked only at the
 * bridge client and the clock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { queryNick } = vi.hoisted(() => ({ queryNick: vi.fn() }));

vi.mock("@/lib/nickstire/query", () => ({ queryNick }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: {} }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { __ruleTriggerForTest } from "@/lib/brain/autonomous-engine";

const trigger = (name: string) => {
  const t = __ruleTriggerForTest(name);
  if (!t) throw new Error(`no rule named ${name}`);
  return t;
};

const answer = (data: unknown) => ({ data, query: "revenue_range", timestamp: "2026-10-09T18:00:00.000Z" });

beforeEach(() => {
  queryNick.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("friday_revenue_check", () => {
  // Friday 2026-10-09, 14:10 EDT.
  const FRIDAY_2PM = new Date("2026-10-09T18:10:00Z");

  it("asks for month-to-date as shop days, the 1st through today", async () => {
    vi.setSystemTime(FRIDAY_2PM);
    queryNick.mockResolvedValue(answer({ from: "2026-10-01", to: "2026-10-09", totalDollars: 4000, invoiceCount: 9 }));

    const items = (await trigger("friday_revenue_check")()) as Array<{ actual: number; projected: number }>;

    expect(queryNick).toHaveBeenCalledTimes(1);
    expect(queryNick).toHaveBeenCalledWith("revenue_range", { from: "2026-10-01", to: "2026-10-09" });
    // $4,000 over 9 days projects $13,778 for October: behind a $20,000 target, so it fires.
    expect(items).toHaveLength(1);
    expect(items[0].actual).toBe(4000);
    expect(Math.round(items[0].projected)).toBe(13778);
  });

  it("stays quiet when the month is on pace", async () => {
    vi.setSystemTime(FRIDAY_2PM);
    queryNick.mockResolvedValue(answer({ totalDollars: 7000, invoiceCount: 20 }));
    expect(await trigger("friday_revenue_check")()).toEqual([]);
  });

  it("does not project from a body with no numeric total", async () => {
    vi.setSystemTime(FRIDAY_2PM);
    queryNick.mockResolvedValue(answer({ error: "No DB" }));
    expect(await trigger("friday_revenue_check")()).toEqual([]);
  });

  it("does not ask the bridge outside Friday 2pm", async () => {
    vi.setSystemTime(new Date("2026-10-08T18:10:00Z")); // Thursday
    expect(await trigger("friday_revenue_check")()).toEqual([]);
    expect(queryNick).not.toHaveBeenCalled();
  });
});

describe("revenue_overconfidence_gate", () => {
  // 09:05 EDT on Friday 2026-10-09: "yesterday" is Thursday 10-08.
  const MORNING = new Date("2026-10-09T13:05:00Z");

  it("asks for yesterday as one shop day", async () => {
    vi.setSystemTime(MORNING);
    queryNick.mockResolvedValue(answer({ from: "2026-10-08", to: "2026-10-08", totalDollars: 2600, invoiceCount: 6 }));

    const items = await trigger("revenue_overconfidence_gate")();

    expect(queryNick).toHaveBeenCalledWith("revenue_range", { from: "2026-10-08", to: "2026-10-08" });
    expect(items).toEqual([{ revenue: 2600 }]);
  });

  it("stays quiet on an ordinary day", async () => {
    vi.setSystemTime(MORNING);
    queryNick.mockResolvedValue(answer({ totalDollars: 1200, invoiceCount: 4 }));
    expect(await trigger("revenue_overconfidence_gate")()).toEqual([]);
  });

  it("does not fire on a body with no numeric total", async () => {
    vi.setSystemTime(MORNING);
    queryNick.mockResolvedValue(answer({ error: "No DB" }));
    expect(await trigger("revenue_overconfidence_gate")()).toEqual([]);
  });
});
