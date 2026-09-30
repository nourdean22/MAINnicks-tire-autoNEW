/**
 * Q-23 phase 2 · the two findings carried from the phase-1 review (#2815).
 *
 * 1. With no invoice ever synced, the revenue figure is not a lower bound of
 *    anything, so it must read UNMEASURED, not ESTIMATE, and the banner must not
 *    call it "understated".
 * 2. A tile naming a metric the contract does not carry still throws in dev and
 *    test (the rename gate), but a production bundle keeps the card up.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    controlCenter: {
      todayPulse: { useQuery: () => ({ data: h.data, isLoading: false }) },
    },
  },
}));

import { TodaysRealNumbers } from "../pages/admin/today/TodaysRealNumbers";
import { tileMetricProvenance, todayPulseProvenance } from "../pages/admin/today/todayPulse";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function pulse(throughDate: Date | null) {
  return {
    available: true,
    declinedWork: { openCount: 12, openCents: 4_130_000, last30: 3 },
    calls: { last24h: 40, reachedTool24h: 9, abandoned24h: 5, lastCallAt: new Date() },
    revenue: { invoices7d: 0, revenue7dCents: 0, throughDate },
  };
}

function revenueTag(container: HTMLElement) {
  const revenueLine = Array.from(container.querySelectorAll(".text-lg")).find((el) =>
    el.closest("div.min-w-0")?.textContent?.includes("paid invoices"),
  );
  return revenueLine?.querySelector("[data-provenance]")?.getAttribute("data-provenance");
}

describe("TodaysRealNumbers · a never-synced invoice mirror", () => {
  it("labels the revenue figure UNMEASURED, not ESTIMATE", () => {
    h.data = pulse(null);
    const { container } = render(<TodaysRealNumbers />);
    expect(revenueTag(container)).toBe("UNMEASURED");
  });

  it("says revenue is not measured instead of calling $0 understated", () => {
    h.data = pulse(null);
    const { container } = render(<TodaysRealNumbers />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/No invoices have synced yet/);
    expect(text).not.toMatch(/understated/);
  });

  // Positive control: a mirror that did sync, however late, keeps the phase-1 label.
  it("a synced but stale mirror still reads ESTIMATE and understated", () => {
    h.data = pulse(new Date(Date.now() - 10 * 86_400_000));
    const { container } = render(<TodaysRealNumbers />);
    expect(revenueTag(container)).toBe("ESTIMATE");
    expect(container.textContent ?? "").toMatch(/understated/);
  });
});

describe("todayPulseProvenance · never synced", () => {
  it("never-synced outranks stale", () => {
    expect(todayPulseProvenance(true, true).revenue).toBe("UNMEASURED");
  });

  it("leaves every other tile's label alone", () => {
    const { revenue: _a, ...rest } = todayPulseProvenance(true, true);
    const { revenue: _b, ...base } = todayPulseProvenance(true);
    expect(rest).toEqual(base);
  });
});

describe("tileMetricProvenance", () => {
  it("reads the contract for a known name", () => {
    expect(tileMetricProvenance("Estimated recovery opportunity")).toBe("ESTIMATE");
    expect(tileMetricProvenance("Tool engagements")).toBe("MEASURED");
  });

  it("still throws on an unknown name in dev and test, so CI catches a rename", () => {
    expect(() => tileMetricProvenance("Conversions")).toThrow(/not in CANONICAL_METRICS/);
  });

  it("falls back to ESTIMATE in a production bundle instead of crashing the card", () => {
    vi.stubEnv("DEV", false);
    expect(tileMetricProvenance("Conversions")).toBe("ESTIMATE");
  });
});
