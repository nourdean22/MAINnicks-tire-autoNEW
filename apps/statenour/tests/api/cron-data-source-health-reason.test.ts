/**
 * tests/api/cron-data-source-health-reason.test.ts · 2026-11-06 (Nick audit A3)
 *
 * The cron row is what Nick's audit reads. It said "1 of 7 probes failing" four times (10-31..11-01)
 * with no probe named, so the audit could only report "no error text". The names were already
 * computed for the coach banner; the cron reason carries them too. Control: a clean run has no reason.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ probes: vi.fn() }));
vi.mock("@/lib/utils/http", () => ({ cronHandler: (fn: () => Promise<unknown>) => fn }));
vi.mock("@/lib/contracts/data-source-health", () => ({ runHealthProbes: h.probes }));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent: vi.fn(async () => null) }));

import { GET } from "@/app/api/cron/data-source-health/route";

const run = GET as unknown as () => Promise<{ ok: boolean; reason?: string }>;

describe("data-source-health cron reason", () => {
  it("names the failing probe, not only the count", async () => {
    h.probes.mockResolvedValueOnce({
      total: 2, ok: 1, failed: 1, empty: 0,
      results: [
        { name: "shop-revenue", kind: "shop", ok: true },
        { name: "apple-health", kind: "personal", ok: false },
      ],
    });
    const out = await run();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("1 of 2 probes failing: apple-health");
  });

  it("CONTROL: a clean run files no reason", async () => {
    h.probes.mockResolvedValueOnce({
      total: 1, ok: 1, failed: 0, empty: 0,
      results: [{ name: "shop-revenue", kind: "shop", ok: true }],
    });
    const out = await run();
    expect(out.ok).toBe(true);
    expect(out.reason).toBeUndefined();
  });
});
