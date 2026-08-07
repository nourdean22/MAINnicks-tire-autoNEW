/**
 * The previous-complete-shop-day computation used by the
 * revenue-reconciliation cron (server/cron/scheduler.ts).
 *
 * Pins the two defects found in prod on 2026-08-08:
 *   · the job read TODAY SO FAR while firing mid-morning ET, reporting "$0,
 *     0 jobs" on 7 of 8 days the shop actually took money;
 *   · it must resolve the day in the SHOP timezone, not the container's —
 *     prod containers run UTC, where "today" starts at 20:00 ET the day before.
 */
import { describe, it, expect } from "vitest";
import { BUSINESS } from "@shared/business";

/** Exactly the expression the cron uses. Kept in lockstep with scheduler.ts. */
function previousShopDay(now: Date): string {
  const shopToday = now.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
  const prev = new Date(`${shopToday}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  return prev.toISOString().slice(0, 10);
}

describe("previousShopDay", () => {
  it("returns the prior calendar day for a mid-morning ET run", () => {
    // 2026-08-07 11:59 UTC = 07:59 ET — one of the actual observed fire times.
    expect(previousShopDay(new Date("2026-08-07T11:59:47Z"))).toBe("2026-08-06");
  });

  it("still returns the prior SHOP day after 00:00 UTC (= 20:00 ET, same shop day)", () => {
    // THE TIMEZONE TRAP: 2026-08-07T02:00Z is already Aug 7 in UTC, but it is
    // still the evening of Aug 6 at the shop. Using the container's date here
    // would skip Aug 6 entirely and re-report Aug 5.
    expect(previousShopDay(new Date("2026-08-07T02:00:00Z"))).toBe("2026-08-05");
    // ...and once ET rolls over to Aug 7, the answer becomes Aug 6.
    expect(previousShopDay(new Date("2026-08-07T05:00:00Z"))).toBe("2026-08-06");
  });

  it("crosses a month boundary correctly", () => {
    expect(previousShopDay(new Date("2026-08-01T16:00:00Z"))).toBe("2026-07-31");
  });

  it("never returns today", () => {
    const now = new Date("2026-08-07T16:00:00Z");
    const shopToday = now.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
    expect(previousShopDay(now)).not.toBe(shopToday);
  });
});
