/**
 * Two live readers and one writer that the shop-clock change broke (2026-10-15).
 *
 * - The Snap approval bridge converted the arrival time to the shop clock, and recordSnapPayment
 *   converted it again, so an approval stored 4-5 hours early. The bridge must hand over the instant;
 *   recordSnapPayment converts it once.
 * - cars-today counted paid invoices between the UTC bounds of the shop day. invoiceDate now holds the
 *   shop's wall clock, so the count was off by 4-5 hours. It must compare the shop day key.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  dispatch: vi.fn(async (..._args: unknown[]) => undefined),
}));

// The recorder dispatches invoice_paid on the real event bus, which reaches the StateNour bridge. A unit
// test must not send events: the bus is replaced, and the test checks what would have been dispatched.
vi.mock("../services/eventBus", () => ({
  dispatch: (...args: unknown[]) => h.dispatch(...args),
}));

vi.mock("../db", () => {
  const fakeDb = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        h.inserted.push(row);
        return { $returningId: async () => [{ id: 1 }] };
      },
    }),
  };
  return { getDb: async () => fakeDb };
});

import { recordSnapPayment } from "../services/snapFinanceSync";

const SERVER = path.resolve(__dirname, "..");
const bridge = readFileSync(path.join(SERVER, "_core/statenour-bridge-routes.ts"), "utf8");

describe("the Snap approval is converted to the shop clock exactly once", () => {
  it("recordSnapPayment stores an approval instant as the shop's wall clock: 22:00 on Oct 14 for 02:00Z on Oct 15", async () => {
    h.inserted = [];
    await recordSnapPayment({
      customerName: "Pat",
      customerPhone: "",
      amount: 100,
      snapApplicationId: "A1",
      approvedAt: new Date("2026-10-15T02:00:00Z"),
    });
    const row = h.inserted[0] as { invoiceDate: Date };
    expect(row.invoiceDate.toISOString()).toBe("2026-10-14T22:00:00.000Z");
    // The event is replaced, not sent: the mock records the invoice_paid it would have dispatched.
    // The event carries dollars (the recorder's amount is 100 dollars), not the cents the row stores.
    expect(h.dispatch).toHaveBeenCalledWith("invoice_paid", expect.objectContaining({ totalAmount: 100 }));
  });

  it("the Snap bridge hands recordSnapPayment the arrival instant, not a wall-clock value it would convert again", () => {
    expect(bridge).toContain("approvedAt: new Date(),");
    expect(bridge).not.toContain("approvedAt: shopWallClock(),");
  });
});

describe("cars-today counts the shop's paid invoices for the shop's day", () => {
  it("compares invoiceDate with the shop day key, not the UTC day bounds", () => {
    expect(bridge).toContain("WHERE invoiceDate >= ${todayET} AND invoiceDate < ${shiftDateKey(todayET, 1)}");
    expect(bridge).not.toContain("invoiceDate >= ${startUtc}");
  });
});
