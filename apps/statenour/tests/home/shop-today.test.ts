/**
 * Home's Nick's Tire card (2026-10-30, home-pulse W2). Nour, 13:53 EDT: "u can put a small nicks tire card
 * on there with total sales for the day". Sales = the shop's counter invoices for the shop day (each a
 * closed job), read from the bridge's revenue_today. ONE reader for that payload: readNickRevenue
 * (lib/nickstire/revenue.ts). The Pulse ticker read `totalDollars` directly and dropped any other key shape.
 *
 * Three states: measured sales, measured zero, unknown. A failed read is never $0.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ batch: {} as Record<string, unknown>, never: false }));
vi.mock("@/lib/nickstire/query", async (orig) => ({
  ...(await orig<typeof import("@/lib/nickstire/query")>()),
  queryNickBatch: vi.fn(async () => h.batch),
  queryNick: vi.fn(() =>
    h.never ? new Promise(() => {}) : Promise.resolve({ data: { totalDollars: 410, invoiceCount: 2, syncedAt: "2026-10-30T18:40:00.000Z" }, query: "revenue_today", timestamp: "t" }),
  ),
}));
vi.mock("@/lib/utils/cache", () => ({ cached: (_k: string, _t: number, fn: () => unknown) => fn() }));
vi.mock("@/lib/ultron/timelines", () => ({ computeInputs: vi.fn(), generateTimelines: vi.fn() }));

import { buildShopToday, shopTodayFrom, SHOP_READ_DEADLINE_MS } from "@/lib/home/shop-today";
import { fetchShopPulse } from "@/lib/services/ultron-ticker";

const ok = (data: unknown) => ({ data, query: "revenue_today", timestamp: "2026-10-30T18:00:00Z" });

describe("shopTodayFrom (the Home card's reading)", () => {
  it("reads sales and job count", () => {
    expect(shopTodayFrom(ok({ totalDollars: 1240, invoiceCount: 6 }))).toMatchObject({
      status: "ok",
      dollars: 1240,
      jobs: 6,
    });
  });

  it("a measured zero is a real zero", () => {
    expect(shopTodayFrom(ok({ totalDollars: 0, invoiceCount: 0 }))).toMatchObject({ status: "ok", dollars: 0 });
  });

  it("a bridge error is unknown, never $0", () => {
    const r = shopTodayFrom({ error: "No sync key configured." });
    expect(r.status).toBe("unknown");
    expect(r).not.toHaveProperty("dollars");
  });

  it("an answer with no revenue figure is unknown, never $0", () => {
    expect(shopTodayFrom(ok({ invoiceCount: 2 })).status).toBe("unknown");
    expect(shopTodayFrom(undefined).status).toBe("unknown");
  });

  // 2026-10-31 (missed-asks row 48): the card's "as of" is the shop's sync time from the payload, never the
  // time we read it. The old `asOf: now.toISOString()` stamped the read, so a day-old sync looked fresh.
  describe("syncedAt (the shop's sync time)", () => {
    it("carries a present stamp from today", () => {
      const r = shopTodayFrom(ok({ totalDollars: 1240, invoiceCount: 6, syncedAt: "2026-10-30T18:40:00.000Z" }));
      expect(r).toMatchObject({ status: "ok", syncedAt: "2026-10-30T18:40:00.000Z" });
    });

    it("carries a stamp from yesterday as is: an old value is true, a failed probe never moves it", () => {
      const r = shopTodayFrom(ok({ totalDollars: 0, invoiceCount: 0, syncedAt: "2026-10-29T23:00:00.000Z" }));
      expect(r).toMatchObject({ status: "ok", dollars: 0, syncedAt: "2026-10-29T23:00:00.000Z" });
    });

    it("null stays null: sync time unknown, and the figures still show", () => {
      expect(shopTodayFrom(ok({ totalDollars: 1240, invoiceCount: 6, syncedAt: null }))).toMatchObject({
        status: "ok",
        dollars: 1240,
        syncedAt: null,
      });
    });

    it("absent (an older nickstire) is null, not the read time", () => {
      const r = shopTodayFrom(ok({ totalDollars: 1240, invoiceCount: 6 }));
      expect(r).toMatchObject({ status: "ok", syncedAt: null });
    });

    it("the read time is retired: no asOf field, so nothing can render it as the sync time", () => {
      const r = shopTodayFrom(ok({ totalDollars: 1240, invoiceCount: 6, syncedAt: "2026-10-30T18:40:00.000Z" }));
      expect(r).not.toHaveProperty("asOf");
    });

    it("an unknown read carries no stamp", () => {
      expect(shopTodayFrom({ error: "No DB" })).not.toHaveProperty("syncedAt");
    });
  });
});

describe("the Pulse ticker reads shop revenue through the same reader", () => {
  it("a revenue payload in cents still renders (the direct totalDollars read dropped it)", async () => {
    h.batch = {
      revenue_today: ok({ todayCents: 12_500, invoiceCount: 3 }),
      leads_urgent: ok({ count: 0 }),
      callbacks_pending: ok({ count: 0 }),
      attention_needed: ok({ alerts: [] }),
    };
    const items = await fetchShopPulse();
    expect(items.find((i) => i.id === "shop-rev")?.label).toBe("$125 today · 3 jobs");
  });

  it("control: the canonical dollars shape renders as before", async () => {
    h.batch = {
      revenue_today: ok({ totalDollars: 980, invoiceCount: 4 }),
      leads_urgent: ok({ count: 0 }),
      callbacks_pending: ok({ count: 0 }),
      attention_needed: ok({ alerts: [] }),
    };
    expect((await fetchShopPulse()).find((i) => i.id === "shop-rev")?.label).toBe("$980 today · 4 jobs");
  });
});

// Codex P1 on #3405: Home's first reads share ONE httpBatchLink request, and queryNick retries a timeout three
// times at 12 s each, so a slow or down shop held the NOW sentence and the brief for about 50 s. The shop read
// now has a hard deadline and says unknown when it passes.
describe("buildShopToday has a deadline", () => {
  it("a shop that never answers is unknown within the deadline, not ~50 s later", async () => {
    vi.useFakeTimers();
    h.never = true;
    const p = buildShopToday();
    await vi.advanceTimersByTimeAsync(SHOP_READ_DEADLINE_MS);
    await expect(p).resolves.toMatchObject({ status: "unknown" });
    h.never = false;
    vi.useRealTimers();
  });
  it("control: a prompt answer is read as before", async () => {
    await expect(buildShopToday()).resolves.toMatchObject({
      status: "ok",
      dollars: 410,
      jobs: 2,
      syncedAt: "2026-10-30T18:40:00.000Z", // the consumer end: bridge answer -> the tRPC output the card reads
    });
  });
});
