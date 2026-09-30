/**
 * Q-23 phase 5 · the Lead SLA Monitor (Admin > Intelligence HQ).
 *
 * The card read `masterReport.marketing.leadResponse` through `|| 0`, so a
 * failed engine (`null`), a failed engine read (zeros with `unavailable: true`)
 * and a 90-day window with no contacted lead all painted the same emerald
 * "Avg: 0m", a perfect response time. An empty bucket read "0% conversion rate".
 *
 * Pinned here:
 *   - a failed engine or a failed read renders UNMEASURED, "unknown", no 0m;
 *   - an empty window renders no average, never an emerald 0m;
 *   - a real average wears MEASURED and keeps its colour;
 *   - an empty bucket says it has no leads instead of a 0% rate.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ report: undefined as unknown }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    intelligence: {
      masterReport: {
        useQuery: () => ({ data: h.report, isLoading: false, isError: false, error: null }),
      },
    },
  },
}));

vi.mock("../pages/admin/shared", () => ({ LoadingState: () => null }));

import { LeadSLAMonitor } from "../pages/admin/intelligence/LeadSLAMonitor";

afterEach(cleanup);

const withLeadResponse = (leadResponse: unknown) => ({ marketing: { leadResponse } });

const buckets = (under5: [number, number], over1h: [number, number], mid = 0) => [
  { bucket: "Under 5 min", leads: under5[0], converted: 0, rate: under5[1] },
  { bucket: "5-30 min", leads: mid, converted: 0, rate: 0 },
  { bucket: "30-60 min", leads: 0, converted: 0, rate: 0 },
  { bucket: "Over 1 hour", leads: over1h[0], converted: 0, rate: over1h[1] },
];

const engineZeros = { avgMinutes: 0, under5min: 0, under30min: 0, over1hour: 0, conversionBySpeed: [] };

function avgBadge(container: HTMLElement) {
  return container.querySelector("[data-sla-avg]");
}

function tags(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-provenance]")).map(
    (el) => el.getAttribute("data-provenance") ?? "",
  );
}

describe("LeadSLAMonitor · unknown is not zero", () => {
  it("a failed engine (null leadResponse) renders UNMEASURED, not an emerald Avg: 0m", () => {
    h.report = withLeadResponse(null);
    const { container } = render(<LeadSLAMonitor />);
    expect(avgBadge(container)?.textContent).toBe("Avg: unknown");
    expect(avgBadge(container)?.className).not.toMatch(/emerald/);
    expect(container.textContent).not.toMatch(/0m\b/);
    expect(container.querySelector("[data-sla-unread]")).not.toBeNull();
    expect(tags(container)).toEqual(["UNMEASURED"]);
    // No bucket counts that would read as "0 leads" measured.
    expect(container.textContent).not.toMatch(/0 leads/);
    // Q-23 phase 6 · the #2829 L8 survivor: no Impact Analysis on an unknown read.
    expect(container.textContent).not.toMatch(/Impact Analysis/);
    expect(container.textContent).not.toMatch(/Not enough recent conversion data/);
  });

  it("a failed engine read (zeros + unavailable) renders UNMEASURED, not 0 minutes", () => {
    h.report = withLeadResponse({ ...engineZeros, unavailable: true });
    const { container } = render(<LeadSLAMonitor />);
    expect(avgBadge(container)?.textContent).toBe("Avg: unknown");
    expect(tags(container)).toEqual(["UNMEASURED"]);
    expect(container.textContent).toMatch(/unknown, not 0 minutes/);
    expect(container.textContent).not.toMatch(/Impact Analysis/);
  });

  it("an empty 90-day window shows no average, never an emerald 0m", () => {
    h.report = withLeadResponse({ ...engineZeros, conversionBySpeed: buckets([0, 0], [0, 0]) });
    const { container } = render(<LeadSLAMonitor />);
    expect(avgBadge(container)?.textContent).toBe("Avg: none");
    expect(avgBadge(container)?.className).not.toMatch(/emerald/);
    expect(container.querySelector("[data-sla-empty]")).not.toBeNull();
    // The empty count is a real read, so it is MEASURED; the rate is absent.
    expect(tags(container)).toEqual(["MEASURED"]);
    expect(container.textContent).not.toMatch(/0% conversion rate/);
  });

  it("a real average wears MEASURED and keeps its colour", () => {
    h.report = withLeadResponse({
      avgMinutes: 12,
      under5min: 3,
      under30min: 5,
      over1hour: 1,
      conversionBySpeed: buckets([3, 67], [1, 0], 2),
    });
    const { container } = render(<LeadSLAMonitor />);
    expect(avgBadge(container)?.textContent).toBe("Avg: 12m");
    expect(avgBadge(container)?.className).toMatch(/emerald/);
    expect(tags(container)).toEqual(["MEASURED"]);
    expect(container.textContent).toMatch(/3 leads/);
    expect(container.textContent).toMatch(/67% conversion rate/);
    // Over 1 hour has a lead that did not convert: a real 0%, not "no leads".
    expect(container.textContent).toMatch(/0% conversion rate/);
    expect(container.querySelector("[data-sla-unread]")).toBeNull();
  });

  it("an empty bucket says it has no leads instead of a 0% rate", () => {
    h.report = withLeadResponse({
      avgMinutes: 40,
      under5min: 0,
      under30min: 0,
      over1hour: 0,
      conversionBySpeed: buckets([0, 0], [0, 0], 4),
    });
    const { container } = render(<LeadSLAMonitor />);
    expect(avgBadge(container)?.textContent).toBe("Avg: 40m");
    expect(container.textContent).not.toMatch(/0% conversion rate/);
    expect(container.textContent?.match(/no leads to convert/g)?.length).toBe(2);
  });
});
