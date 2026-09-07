/**
 * A total intelligence outage must not render as a health score.
 *
 * THE DEFECT. `settled()` maps a rejected engine to null and every scoring block
 * is `if (engine)`, so a dead engine is ABSENT from the score rather than
 * penalised. The scale starts at a baseline of 50. With every engine dead the
 * report therefore returned score 50, "No critical alerts — systems nominal",
 * no risks and no opportunities — and the failure list reached the operator only
 * as a count on a COLLAPSED accordion label.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE SERVICE FIX. The service now computes
 * `scoreReliable`, but the first version of that fix computed it and nothing
 * rendered it — a writer with no reader, which is this repo's most-recorded
 * defect shape. The service change is only worth anything if the PANEL changes,
 * so the panel is what is asserted here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({ result: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown } }));

vi.mock("@/lib/trpc", () => ({
  trpc: { intelligence: { masterReport: { useQuery: () => h.result } } },
}));

import { AIHealthPanel } from "../pages/admin/intelligence/AIHealthPanel";

const report = (summary: Record<string, unknown>) => ({
  data: {
    timestamp: new Date().toISOString(),
    summary: {
      topAlert: "x", topOpportunity: "y", topRisk: "z",
      score: 50, scoreBreakdown: [], failures: [],
      scoreReliable: true, enginesFailed: 0, enginesTotal: 30,
      ...summary,
    },
  },
  isLoading: false, isError: false, error: null,
});

afterEach(cleanup);
beforeEach(() => { h.result = report({}); });

describe("a healthy report still shows its score", () => {
  it("renders the number when the engines ran", () => {
    h.result = report({ score: 72 });
    render(<AIHealthPanel />);
    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByText(/Health Score/i)).toBeTruthy();
  });

  it("shows no outage banner when nothing failed", () => {
    render(<AIHealthPanel />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("an outage is UNKNOWN, not 50/100", () => {
  beforeEach(() => {
    h.result = report({ scoreReliable: false, enginesFailed: 28, enginesTotal: 30, score: 50 });
  });

  it("refuses to print a number that describes silence", () => {
    render(<AIHealthPanel />);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText(/Score unavailable/i)).toBeTruthy();
  });

  it("states the outage where the number would be, not on a collapsed label", () => {
    render(<AIHealthPanel />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/28 of 30 intelligence engines failed/);
    expect(alert.textContent).toMatch(/UNKNOWN, not average/);
  });

  it("does not render the reassuring score anywhere", () => {
    render(<AIHealthPanel />);
    // "50" on this scale is amber-to-green and reads as fine.
    expect(screen.queryByText("50")).toBeNull();
  });
});

describe("an older cached report without the flag still renders", () => {
  it("treats a missing scoreReliable as reliable rather than blanking the panel", () => {
    // The field is optional so a report generated before this change (or a
    // cached one) does not turn the whole panel into an outage warning.
    h.result = report({ score: 64, scoreReliable: undefined });
    render(<AIHealthPanel />);
    expect(screen.getByText("64")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
