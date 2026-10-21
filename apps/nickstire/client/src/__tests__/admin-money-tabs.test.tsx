/**
 * Money tab strip (2026-10-21): there is no Unpaid tab.
 *
 * Payment is collected on a separate register, so the system cannot know whether an invoice was
 * paid. A worklist of "unpaid invoices" is false by construction and was removed with its
 * procedure (invoices.unpaidList) and service (collectionsWindow).
 *
 * The consumer here is what the operator sees: the tab strip, and what an old bookmarked
 * `?moneyTab=unpaid` link opens. The section files are stubbed so the test reads the tab wiring
 * and the URL fallback, not the data screens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/trpc", () => {
  const procedure = () => ({
    useQuery: () => ({ data: undefined, isLoading: false, isPending: false, isError: false, error: null, refetch: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, reset: vi.fn() }),
  });
  const trpc = new Proxy({}, { get: () => new Proxy({}, { get: () => procedure() }) });
  return { trpc };
});

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  useLocation: () => ["/admin", vi.fn()],
  useSearch: () => window.location.search,
}));

const stub = (id: string) => ({ default: () => React.createElement("div", { "data-testid": id }) });
vi.mock("../pages/admin/money/WorkOrdersSection", () => stub("shop-pulse"));
vi.mock("../pages/admin/money/DispatchSection", () => stub("shop-status"));
vi.mock("../pages/admin/money/DeclinedEstimatesSection", () => stub("declined"));
vi.mock("../pages/admin/money/SnapDashboardSection", () => stub("financing"));
vi.mock("../pages/admin/money/FinancingAttribution", () => ({ FinancingAttribution: () => null }));

const open = async (search: string) => {
  window.history.replaceState({}, "", `/admin${search}`);
  const { default: RevenueSection } = await import("../pages/admin/RevenueSection");
  return render(React.createElement(RevenueSection));
};

beforeEach(() => {
  window.history.replaceState({}, "", "/admin");
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("Money tab strip", () => {
  it("shows Shop Pulse, Declined, Financing, Shop Status in that order, and no Unpaid", async () => {
    const { container } = await open("");
    const labels = Array.from(container.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
    expect(labels).toEqual(["Shop Pulse", "Declined", "Financing", "Shop Status"]);
    expect(screen.queryByRole("button", { name: /unpaid/i })).toBeNull();
    expect(await screen.findByTestId("shop-pulse")).toBeTruthy();
  });

  it("an old ?moneyTab=unpaid link opens the default tab with no error", async () => {
    const { container } = await open("?moneyTab=unpaid");
    expect(await screen.findByTestId("shop-pulse")).toBeTruthy();
    expect(within(container).queryByRole("button", { name: /unpaid/i })).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/unpaid invoices/i);
    expect(container.textContent ?? "").not.toMatch(/error|could not/i);
  });

  it("POSITIVE CONTROL: the URL does choose the tab (declined opens Declined, not the default)", async () => {
    await open("?moneyTab=declined");
    expect(await screen.findByTestId("declined")).toBeTruthy();
    expect(screen.queryByTestId("shop-pulse")).toBeNull();
  });
});
