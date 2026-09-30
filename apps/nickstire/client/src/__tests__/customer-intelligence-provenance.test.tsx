/**
 * Q-23 phase 6 · the Customer Intelligence card (Admin > Intelligence HQ).
 *
 * "Due For Maintenance" read `repeatPrediction.recommendations.length`, a field
 * predictRepeatVisits has never returned, so it was 0 on every render. "High
 * Churn Risk" read through `|| 0`, so a failed engine painted a clean 0. The
 * empty VIP list said "Retention looks solid" although the list is the top 8
 * of the whole action queue.
 *
 * Pinned here:
 *   - a failed engine or a failed engine read renders "unknown" UNMEASURED, never 0;
 *   - the due count reads `dueSoon`, the field the engine returns;
 *   - a read count wears ESTIMATE (a heuristic score, not a count of events);
 *   - a list at the engine's cap reads "N+", a floor, not a total;
 *   - an empty VIP list makes no retention claim.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ report: undefined as unknown, actions: [] as unknown[] }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    intelligence: {
      masterReport: {
        useQuery: () => ({ data: h.report, isLoading: false, isError: false }),
      },
      nextBestActions: {
        useQuery: () => ({ data: { actions: h.actions }, isLoading: false, isError: false }),
      },
    },
  },
}));

vi.mock("../pages/admin/shared", () => ({ LoadingState: () => null }));

import { CustomerIntelligence } from "../pages/admin/intelligence/CustomerIntelligence";

afterEach(() => {
  cleanup();
  h.actions = [];
});

const withCustomers = (churnRisk: unknown, repeatPrediction: unknown) => ({
  customers: { churnRisk, repeatPrediction },
});

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `C${i}` }));

function signal(container: HTMLElement, name: string) {
  const el = container.querySelector(`[data-signal="${name}"]`);
  return {
    text: el?.textContent,
    tag: el?.parentElement?.querySelector("[data-provenance]")?.getAttribute("data-provenance"),
  };
}

describe("CustomerIntelligence · unknown is not zero", () => {
  it("failed engines (null results) render unknown and UNMEASURED, never 0", () => {
    h.report = withCustomers(null, null);
    const { container } = render(<CustomerIntelligence />);
    expect(signal(container, "churn")).toEqual({ text: "unknown", tag: "UNMEASURED" });
    expect(signal(container, "due")).toEqual({ text: "unknown", tag: "UNMEASURED" });
  });

  it("failed engine reads (empty lists + unavailable) render unknown, not 0", () => {
    h.report = withCustomers(
      { highRisk: [], mediumRisk: [], unavailable: true },
      { dueSoon: [], overdueCount: 0, unavailable: true },
    );
    const { container } = render(<CustomerIntelligence />);
    expect(signal(container, "churn")).toEqual({ text: "unknown", tag: "UNMEASURED" });
    expect(signal(container, "due")).toEqual({ text: "unknown", tag: "UNMEASURED" });
  });

  it("the due count reads dueSoon, the field predictRepeatVisits returns", () => {
    h.report = withCustomers({ highRisk: rows(3), mediumRisk: [] }, { dueSoon: rows(7), overdueCount: 2 });
    const { container } = render(<CustomerIntelligence />);
    expect(signal(container, "churn")).toEqual({ text: "3", tag: "ESTIMATE" });
    expect(signal(container, "due")).toEqual({ text: "7", tag: "ESTIMATE" });
  });

  it("a successful empty read is a real 0, tagged ESTIMATE", () => {
    h.report = withCustomers({ highRisk: [], mediumRisk: [] }, { dueSoon: [], overdueCount: 0 });
    const { container } = render(<CustomerIntelligence />);
    expect(signal(container, "churn")).toEqual({ text: "0", tag: "ESTIMATE" });
    expect(signal(container, "due")).toEqual({ text: "0", tag: "ESTIMATE" });
  });

  it("a list at the engine's cap reads as a floor", () => {
    h.report = withCustomers({ highRisk: rows(25), mediumRisk: [] }, { dueSoon: rows(30), overdueCount: 30 });
    const { container } = render(<CustomerIntelligence />);
    expect(signal(container, "churn").text).toBe("25+");
    expect(signal(container, "due").text).toBe("30+");
  });

  it("an empty VIP list makes no retention claim", () => {
    h.report = withCustomers({ highRisk: [], mediumRisk: [] }, { dueSoon: [], overdueCount: 0 });
    const { container } = render(<CustomerIntelligence />);
    expect(container.textContent).not.toMatch(/Retention looks solid/);
    expect(container.textContent).toMatch(/not a retention verdict/);
  });
});
