/**
 * Q-23 phase 2 · a card tile naming a metric the contract no longer carries.
 *
 * metricProvenance throws on an unknown name so CI catches a rename (ROS-003).
 * Dev and test must keep throwing; a production bundle must keep the card up and
 * label the tile ESTIMATE, the one label that never overclaims a count.
 *
 * Simulated by removing "Tool engagements" from the contract lookup.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/metricsContract", async (importOriginal) => {
  const real = await importOriginal<typeof import("@shared/metricsContract")>();
  return {
    ...real,
    getCanonicalMetric: (name: string) =>
      name === "Tool engagements" ? undefined : real.getCanonicalMetric(name),
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    controlCenter: {
      todayPulse: {
        useQuery: () => ({
          isLoading: false,
          data: {
            available: true,
            declinedWork: { openCount: 12, openCents: 4_130_000, last30: 3 },
            calls: { last24h: 40, reachedTool24h: 9, abandoned24h: 5, lastCallAt: new Date() },
            revenue: { invoices7d: 21, revenue7dCents: 987_000, throughDate: new Date() },
          },
        }),
      },
    },
  },
}));

import { TodaysRealNumbers } from "../pages/admin/today/TodaysRealNumbers";
import { todayPulseProvenance } from "../pages/admin/today/todayPulse";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("an unknown tile metric", () => {
  it("still throws in dev and test, so CI catches the rename", () => {
    expect(() => todayPulseProvenance(false)).toThrow(/not in CANONICAL_METRICS/);
  });

  it("in a production bundle, labels that tile ESTIMATE and leaves the others alone", () => {
    vi.stubEnv("DEV", false);
    expect(todayPulseProvenance(false)).toEqual({
      declinedWork: "ESTIMATE",
      calls: "MEASURED",
      reachedTool: "ESTIMATE",
      abandoned: "ESTIMATE",
      revenue: "MEASURED",
    });
  });

  it("in a production bundle, the card still renders every number", () => {
    vi.stubEnv("DEV", false);
    const { container } = render(<TodaysRealNumbers />);
    expect(container.querySelectorAll(".text-lg").length).toBe(3);
    const line = Array.from(container.querySelectorAll("[data-provenance]")).find((el) =>
      el.parentElement?.textContent?.includes("reached a booking"),
    );
    expect(line?.getAttribute("data-provenance")).toBe("ESTIMATE");
  });
});
