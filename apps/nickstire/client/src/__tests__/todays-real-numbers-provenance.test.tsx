/**
 * Q-23 · every number on "Today, for real" says whether it was counted or estimated.
 *
 * Before this, $ of declined estimates and $ of paid invoices drew in the same
 * type with no label, so the modeled figure read as money the shop already has.
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
import { todayPulseProvenance } from "../pages/admin/today/todayPulse";

afterEach(cleanup);

const DAY = 86_400_000;

function pulse(throughDaysAgo: number) {
  return {
    available: true,
    declinedWork: { openCount: 12, openCents: 4_130_000, last30: 3 },
    calls: { last24h: 40, reachedTool24h: 9, abandoned24h: 5, lastCallAt: new Date() },
    revenue: {
      invoices7d: 21,
      revenue7dCents: 987_000,
      throughDate: new Date(Date.now() - throughDaysAgo * DAY),
    },
  };
}

function tagsIn(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-provenance]")).map((el) => ({
    label: el.getAttribute("data-provenance"),
    // The tile line the tag sits on, so a test can say WHICH number it labels.
    line: el.parentElement?.textContent ?? "",
  }));
}

describe("TodaysRealNumbers · provenance tags", () => {
  it("labels the declined-work dollars ESTIMATE and the paid revenue MEASURED", () => {
    h.data = pulse(1);
    const { container } = render(<TodaysRealNumbers />);
    const tags = tagsIn(container);

    const declined = tags.find((t) => t.line.includes("41,300"));
    const revenue = tags.find((t) => t.line.includes("9,870"));
    expect(declined?.label).toBe("ESTIMATE");
    expect(revenue?.label).toBe("MEASURED");
  });

  it("every headline number on the card carries a tag", () => {
    h.data = pulse(1);
    const { container } = render(<TodaysRealNumbers />);
    const headlines = Array.from(container.querySelectorAll(".text-lg"));
    expect(headlines.length).toBe(3);
    for (const el of headlines) {
      expect(el.querySelector("[data-provenance]"), el.textContent ?? "").not.toBeNull();
    }
  });

  it("labels the reached-tool count MEASURED and the under-20s hang-ups ESTIMATE", () => {
    h.data = pulse(1);
    const { container } = render(<TodaysRealNumbers />);
    const sub = tagsIn(container).filter((t) => t.line.includes("reached a booking"));
    // Both subline tags share one line; order is reached-tool, then abandoned.
    expect(sub.map((t) => t.label)).toEqual(["MEASURED", "ESTIMATE"]);
  });

  // The card already says revenue is understated when the mirror lags; the tag
  // must agree rather than call a known lower bound a measurement.
  it("a stale invoice mirror turns the revenue tag into ESTIMATE", () => {
    h.data = pulse(10);
    const { container } = render(<TodaysRealNumbers />);
    const revenue = tagsIn(container).find((t) => t.line.includes("9,870"));
    expect(revenue?.label).toBe("ESTIMATE");
  });
});

describe("todayPulseProvenance", () => {
  it("is pure over the mirror-staleness flag", () => {
    expect(todayPulseProvenance(false)).toEqual({
      declinedWork: "ESTIMATE",
      calls: "MEASURED",
      reachedTool: "MEASURED",
      abandoned: "ESTIMATE",
      revenue: "MEASURED",
    });
    expect(todayPulseProvenance(true).revenue).toBe("ESTIMATE");
  });
});
