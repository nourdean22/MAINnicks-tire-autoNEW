/**
 * "Unknown is not $0" — the Command Surface revenue derivation (2026-09-02).
 *
 * nickstire's every-15-minutes push (statenourSync.ts, PR #2063) sends
 * `revenue: { available: false, reason, pacing: "unknown" }` with NO numbers
 * when its own revenue read failed. The old chain in app/api/command/data
 * (`revenue.todayEstimate ?? … ?? 0`) rendered that as a $0 day. These tests
 * lock the contract: absence → null + reason; a counted zero → 0.
 */
import { describe, it, expect } from "vitest";
import { deriveShopRevenue } from "@/lib/nickstire/shop-revenue";

describe("deriveShopRevenue", () => {
  it("THE BUG: a pushed payload that says available:false is UNKNOWN, never $0", () => {
    const r = deriveShopRevenue(null, { revenue: { available: false, reason: "read failed", pacing: "unknown" } });
    expect(r.todayRevenue).toBeNull();
    expect(r.weekRevenue).toBeNull();
    expect(r.revenueAvailable).toBe(false);
    expect(r.revenueReason).toBe("read failed");
    expect(r.source).toBe("none");
  });

  it("positive control: a genuine counted zero stays $0", () => {
    const r = deriveShopRevenue(null, { revenue: { todayEstimate: 0 } });
    expect(r.todayRevenue).toBe(0);
    expect(r.revenueAvailable).toBe(true);
    expect(r.revenueReason).toBeNull();
    expect(r.source).toBe("sync");
  });

  it("no payload anywhere → unknown with our own reason", () => {
    const r = deriveShopRevenue(undefined, null);
    expect(r.todayRevenue).toBeNull();
    expect(r.revenueAvailable).toBe(false);
    expect(r.revenueReason).toMatch(/no revenue reading/);
  });

  it("the live bridge wins when it carries a reading", () => {
    const r = deriveShopRevenue(
      { todayEstimate: 1234, weekEstimate: null },
      { revenue: { totalDollars: 999, weekRevenue: 5000 } },
    );
    expect(r.todayRevenue).toBe(1234);
    expect(r.source).toBe("bridge");
    // week: the live snapshot has no week figure, so the pushed one fills it.
    expect(r.weekRevenue).toBe(5000);
  });

  it("a live snapshot whose todayEstimate is null (bridge query failed) falls through to the last push", () => {
    const r = deriveShopRevenue({ todayEstimate: null, weekEstimate: null }, { revenue: { totalDollars: 2772.2, invoiceCount: 5 } });
    expect(r.todayRevenue).toBe(2772);
    expect(r.source).toBe("sync");
  });

  it("a live snapshot whose todayEstimate is null AND a push that says available:false → unknown with nickstire's reason", () => {
    const r = deriveShopRevenue({ todayEstimate: null, weekEstimate: null }, { revenue: { available: false, reason: "TiDB timeout" } });
    expect(r.todayRevenue).toBeNull();
    expect(r.revenueReason).toBe("TiDB timeout");
  });

  it("legacy top-level keys on the pushed payload are still read", () => {
    const r = deriveShopRevenue(null, { todayEstimate: 120, weekRevenue: 900 });
    expect(r.todayRevenue).toBe(120);
    expect(r.weekRevenue).toBe(900);
    expect(r.source).toBe("sync");
  });

  it("available:false with a blank reason gets a default reason, never an empty string", () => {
    const r = deriveShopRevenue(null, { revenue: { available: false, reason: "   " } });
    expect(r.revenueReason).toBe("revenue read failed");
  });
});
