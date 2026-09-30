/**
 * Q-23 phase 5 · the Money At Risk badge while a slice is unread.
 *
 * #2827 raised a LOW badge to MEDIUM whenever the leads or callbacks read
 * failed (an unread slice may hide the worst item), but no test pinned it: the
 * mutant that dropped the raise survived. These cases kill it at the render.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { displayedRiskSeverity } from "../pages/admin/today/moneyRisks";

const h = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminDashboard: {
      overviewMediumBundle: {
        useQuery: () => ({ data: h.data, isLoading: false, isError: false }),
      },
    },
  },
}));

vi.mock("../pages/admin/shared", () => ({ navigateToAdminSection: vi.fn() }));

import { TodaysMoneyRisks } from "../pages/admin/today/TodaysMoneyRisks";

afterEach(cleanup);

const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const waitingCallback = (name: string) => ({ status: "new", createdAt: ago(5 * HOUR), name });

const ok = { available: true, error: null };
const down = { available: false, error: "read failed" };

function badge(container: HTMLElement): string | null {
  const labels = ["LOW", "MEDIUM", "HIGH"];
  const el = Array.from(container.querySelectorAll("span")).find((s) => labels.includes(s.textContent ?? ""));
  return el?.textContent ?? null;
}

describe("displayedRiskSeverity", () => {
  it("raises LOW to MEDIUM only while a slice is unread", () => {
    expect(displayedRiskSeverity("low", true)).toBe("medium");
    expect(displayedRiskSeverity("low", false)).toBe("low");
    expect(displayedRiskSeverity("medium", true)).toBe("medium");
    expect(displayedRiskSeverity("high", true)).toBe("high");
    expect(displayedRiskSeverity("high", false)).toBe("high");
  });
});

describe("TodaysMoneyRisks · the badge never reads LOW over an unread slice", () => {
  it("control: one waiting callback, everything read, reads LOW", () => {
    h.data = { leads: [], callbacks: [waitingCallback("A")], slices: { leads: ok, callbacks: ok } };
    const { container } = render(<TodaysMoneyRisks />);
    expect(badge(container)).toBe("LOW");
  });

  it("the same callback with the leads read failed reads MEDIUM", () => {
    h.data = { leads: null, callbacks: [waitingCallback("A")], slices: { leads: down, callbacks: ok } };
    const { container } = render(<TodaysMoneyRisks />);
    expect(badge(container)).toBe("MEDIUM");
  });

  it("both reads failed (nothing derivable) reads MEDIUM", () => {
    h.data = { leads: null, callbacks: null, slices: { leads: down, callbacks: down } };
    const { container } = render(<TodaysMoneyRisks />);
    expect(badge(container)).toBe("MEDIUM");
  });

  it("an unread slice never lowers a HIGH", () => {
    const four = ["A", "B", "C", "D"].map(waitingCallback);
    h.data = { leads: null, callbacks: four, slices: { leads: down, callbacks: ok } };
    const { container } = render(<TodaysMoneyRisks />);
    expect(badge(container)).toBe("HIGH");
  });
});
