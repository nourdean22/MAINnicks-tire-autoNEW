/**
 * server/lib/marketWindow.ts · 2026-09-08
 *
 * The Market card says "last 28 days". Built in shop time (America/New_York)
 * with a 27-day subtraction: an INCLUSIVE 28-date span that does not flip a
 * day early at UTC midnight. Consumed by the market admin router; pinned by
 * server/__tests__/market-window.test.ts.
 */
import { getBusinessDateKey } from "./timezoneAssert";

export function marketWindow(now: Date = new Date()): { startDate: string; endDate: string } {
  return {
    startDate: getBusinessDateKey(new Date(now.getTime() - 27 * 86_400_000)),
    endDate: getBusinessDateKey(now),
  };
}
