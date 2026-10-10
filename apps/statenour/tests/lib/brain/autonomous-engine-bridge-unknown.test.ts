/**
 * A bridge read that failed, or came back without the field a rule needs, is
 * UNKNOWN, not zero (audit wave 2, P1 item 3).
 *
 * The quote rules read `count` and `bookedCount` with `?? 0`. A body carrying
 * `count` but no `bookedCount` (a partial or older handler) made booked = 0, so
 * the rule sent "0% conversion (0/12)" and an "overpriced" pricing alert built
 * on a number nobody measured. And a 200 whose data is `{ error: "No DB" }` was
 * treated as data by fetchBridge; readBridge classifies it as unknown.
 *
 * Driven through the real triggers / actions, mocked at the bridge client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { queryNick, sendTelegram } = vi.hoisted(() => ({ queryNick: vi.fn(), sendTelegram: vi.fn() }));

vi.mock("@/lib/nickstire/query", async (orig) => ({
  ...(await orig<typeof import("@/lib/nickstire/query")>()),
  queryNick,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn() } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { __ruleTriggerForTest, __ruleActionForTest } from "@/lib/brain/autonomous-engine";

const trigger = (name: string) => {
  const t = __ruleTriggerForTest(name);
  if (!t) throw new Error(`no rule named ${name}`);
  return t;
};
const answer = (data: unknown) => ({ data, query: "quotes_pending", timestamp: "2026-10-11T15:00:00.000Z" });

// Sunday 2026-10-11, 11:00 EDT (quote_conversion_insight is Sunday-only).
const SUNDAY = new Date("2026-10-11T15:00:00Z");

beforeEach(() => {
  queryNick.mockReset();
  sendTelegram.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(SUNDAY);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("suggest_pricing_adjustment", () => {
  it("does not alert when bookedCount is missing (never a fabricated 0 booked)", async () => {
    queryNick.mockResolvedValue(answer({ count: 12 }));
    expect(await trigger("suggest_pricing_adjustment")()).toEqual([]);
  });

  it("skips on a 200 whose data is an error", async () => {
    queryNick.mockResolvedValue(answer({ error: "No DB" }));
    expect(await trigger("suggest_pricing_adjustment")()).toEqual([]);
  });

  it("POSITIVE CONTROL: a real low conversion still alerts", async () => {
    queryNick.mockResolvedValue(answer({ count: 12, bookedCount: 1 }));
    const items = (await trigger("suggest_pricing_adjustment")()) as Array<{ type: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("overpriced");
  });
});

describe("quote_conversion_insight", () => {
  it("does not fire when bookedCount is missing", async () => {
    queryNick.mockResolvedValue(answer({ count: 20 }));
    expect(await trigger("quote_conversion_insight")()).toEqual([]);
  });

  it("POSITIVE CONTROL: real counts still fire", async () => {
    queryNick.mockResolvedValue(answer({ count: 20, bookedCount: 5 }));
    expect(await trigger("quote_conversion_insight")()).toEqual([{ total: 20, booked: 5, rate: 25 }]);
  });

  it("an unknown price-range read says so instead of an empty breakdown", async () => {
    queryNick.mockResolvedValue({ error: "HTTP 503" });
    const action = __ruleActionForTest("quote_conversion_insight");
    if (!action) throw new Error("no action");
    await action({ total: 20, booked: 5, rate: 25 });
    const msg = String(sendTelegram.mock.calls[0]?.[0]);
    expect(msg).toContain("By price range: unknown");
  });
});

describe("other bridge rules skip on an unknown read", () => {
  it("auto_followup_expired_quote: no follow-ups", async () => {
    queryNick.mockResolvedValue(answer({ error: "No DB" }));
    expect(await trigger("auto_followup_expired_quote")()).toEqual([]);
  });

  it("auto_remind_pending_appointment: no reminders", async () => {
    queryNick.mockResolvedValue({ error: "HTTP 500" });
    expect(await trigger("auto_remind_pending_appointment")()).toEqual([]);
  });
});
