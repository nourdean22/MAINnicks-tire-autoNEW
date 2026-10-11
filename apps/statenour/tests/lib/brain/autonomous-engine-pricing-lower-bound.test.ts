/**
 * The pricing rules act only on an EXACT booked count.
 *
 * THE DEFECT (audit 2026-10-10, P2-B4 item 3). quotes_pending.bookedCount
 * comes from a conservative estimate-to-invoice matcher (matched_invoice_id),
 * so it can be a LOWER BOUND. A matcher miss reads as a lost sale: the rules
 * would understate conversion and advise a price cut ("overpriced") on
 * bookings the matcher never saw. The bridge says which it is with
 * bookedCountIsLowerBound (P2-B5). Only an explicit `false` is exact; true or
 * absent = skip, with a logged reason.
 *
 * Driven through the real triggers, mocked at the bridge client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { queryNick, log } = vi.hoisted(() => ({
  queryNick: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/nickstire/query", async (orig) => ({
  ...(await orig<typeof import("@/lib/nickstire/query")>()),
  queryNick,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn() } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { withSurface: () => log } }));

import { __ruleTriggerForTest } from "@/lib/brain/autonomous-engine";

const trigger = (name: string) => {
  const t = __ruleTriggerForTest(name);
  if (!t) throw new Error(`no rule named ${name}`);
  return t;
};
const answer = (data: unknown) => ({ data, query: "quotes_pending", timestamp: "2026-10-11T15:00:00.000Z" });
const skipLogged = (rule: string) =>
  log.info.mock.calls.some(
    ([, meta]) =>
      (meta as Record<string, unknown> | undefined)?.rule === rule &&
      (meta as Record<string, unknown>).reason === "booked count is a lower bound",
  );

// Sunday 2026-10-11, 11:00 EDT (quote_conversion_insight is Sunday-only).
beforeEach(() => {
  queryNick.mockReset();
  log.info.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T15:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

// 1 of 12 booked = 8%: "overpriced" if the count were exact.
// 18 of 20 booked = 90%: "underpriced" if exact.
describe.each([
  ["suggest_pricing_adjustment", { count: 12, bookedCount: 1 }],
  ["quote_conversion_insight", { count: 20, bookedCount: 18 }],
])("%s", (rule, counts) => {
  it("skips when the booked count is a lower bound, and logs why", async () => {
    queryNick.mockResolvedValue(answer({ ...counts, bookedCountIsLowerBound: true }));
    expect(await trigger(rule)()).toEqual([]);
    expect(skipLogged(rule)).toBe(true);
  });

  it("skips when the bridge does not say (field absent)", async () => {
    queryNick.mockResolvedValue(answer(counts));
    expect(await trigger(rule)()).toEqual([]);
    expect(skipLogged(rule)).toBe(true);
  });

  it("skips on a non-boolean flag (only an explicit false is exact)", async () => {
    queryNick.mockResolvedValue(answer({ ...counts, bookedCountIsLowerBound: "false" }));
    expect(await trigger(rule)()).toEqual([]);
  });

  it("POSITIVE CONTROL: an exact count (false) still acts", async () => {
    queryNick.mockResolvedValue(answer({ ...counts, bookedCountIsLowerBound: false }));
    expect(await trigger(rule)()).toHaveLength(1);
    expect(skipLogged(rule)).toBe(false);
  });
});
