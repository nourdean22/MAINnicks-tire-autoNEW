/**
 * auto_remind_pending_appointment reads a query that answers its question.
 *
 * THE DEFECT (audit 2026-10-10, report 13). The rule asked `bookings_status`
 * for `{ status: "pending", staleHours: 4 }` and read `data.bookings`. That
 * handler ignores filters and returns `{ statusBreakdown }`, so `bookings` was
 * always undefined and the rule never reminded anyone. The name passed the
 * bridge contract test; the shape did not.
 *
 * The rule now asks `bookings_pending_stale` with the SAME filters and reads
 * `{ bookings: [...] }` (task B5 adds the nickstire handler with that contract).
 * An unknown read still skips.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryNick } = vi.hoisted(() => ({ queryNick: vi.fn() }));

vi.mock("@/lib/nickstire/query", async (orig) => ({
  ...(await orig<typeof import("@/lib/nickstire/query")>()),
  queryNick,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn() } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { __ruleTriggerForTest } from "@/lib/brain/autonomous-engine";

const trigger = () => {
  const t = __ruleTriggerForTest("auto_remind_pending_appointment");
  if (!t) throw new Error("rule missing");
  return t;
};

const BOOKING = {
  id: "b1",
  customerName: "Dana",
  customerPhone: "2165550100",
  serviceType: "Brakes",
  preferredDay: "Mon",
  preferredTime: "9am",
  createdAt: "2026-10-10T10:00:00.000Z",
};

/** The bridge as nickstire answers it: the new handler, and the real bookings_status body. */
function bridge(query: string) {
  if (query === "bookings_pending_stale") {
    return { query, timestamp: "t", data: { bookings: [BOOKING] } };
  }
  if (query === "bookings_status") {
    return { query, timestamp: "t", data: { statusBreakdown: [{ status: "pending", cnt: 3 }] } };
  }
  return { error: "HTTP 400" };
}

beforeEach(() => {
  queryNick.mockReset().mockImplementation(async (q: string) => bridge(q));
});

describe("auto_remind_pending_appointment", () => {
  it("asks bookings_pending_stale with the same filters it always sent", async () => {
    await trigger()();
    expect(queryNick).toHaveBeenCalledTimes(1);
    expect(queryNick).toHaveBeenCalledWith("bookings_pending_stale", { status: "pending", staleHours: 4 });
  });

  it("turns each stale booking into one reminder, createdAt as a Date", async () => {
    const items = (await trigger()()) as Array<{ id: string; createdAt: Date }>;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("b1");
    expect(items[0].createdAt).toBeInstanceOf(Date);
    expect(items[0].createdAt.toISOString()).toBe(BOOKING.createdAt);
  });

  it("skips on an unknown read (never reminds off a failed bridge call)", async () => {
    queryNick.mockResolvedValue({ error: "HTTP 500" });
    expect(await trigger()()).toEqual([]);
  });
});
