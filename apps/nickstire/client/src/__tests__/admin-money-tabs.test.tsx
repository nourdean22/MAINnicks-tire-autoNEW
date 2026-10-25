/**
 * Money tab strip (2026-10-25): Billed, Declined, Financing.
 *
 * The work-order board (Shop Pulse), Shop Status and the Snap dashboard read tables the shop never
 * uses (one cancelled work order ever, no technicians, no snap_applications table), so they are gone.
 * There is no Unpaid tab either: payment is taken on a separate register (2026-10-21).
 *
 * The consumer here is what the operator sees: the tab strip, and what an old bookmarked link opens.
 * The tab bodies are stubbed so the test reads the tab wiring and the URL fallback, not the data screens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
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
vi.mock("../pages/admin/SalesCard", () => ({
  default: (p: { variant?: string }) => React.createElement("div", { "data-testid": "billed", "data-variant": p.variant ?? "today" }),
}));
vi.mock("../pages/admin/money/NextEstimate", () => ({
  default: (p: { onOpenDeclined?: () => void }) =>
    React.createElement("button", { "data-testid": "next-estimate", onClick: () => p.onOpenDeclined?.() }, "Open in Declined"),
}));
vi.mock("../pages/admin/money/DeclinedEstimatesSection", () => stub("declined"));
vi.mock("../pages/admin/money/FinancingAttribution", () => ({
  FinancingAttribution: () => React.createElement("div", { "data-testid": "financing" }),
}));

const open = async (search: string) => {
  window.history.replaceState({}, "", `/admin${search}`);
  const { default: RevenueSection } = await import("../pages/admin/RevenueSection");
  return render(React.createElement(RevenueSection));
};
const tabLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button"))
    .filter((b) => !b.hasAttribute("data-testid"))
    .map((b) => (b.textContent ?? "").trim());

beforeEach(() => {
  window.history.replaceState({}, "", "/admin");
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("Money tab strip", () => {
  it("shows Billed, Declined, Financing in that order, and opens on Billed with the money card and one action", async () => {
    const { container } = await open("");
    expect(tabLabels(container)).toEqual(["Billed", "Declined", "Financing"]);
    expect(screen.queryByRole("button", { name: /unpaid|shop pulse|shop status/i })).toBeNull();
    expect((await screen.findByTestId("billed")).getAttribute("data-variant")).toBe("money");
    expect(screen.getByTestId("next-estimate")).toBeTruthy();
  });

  for (const old of ["shopPulse", "shopStatus", "tireOrders", "unpaid", "revenue"]) {
    it(`an old ?moneyTab=${old} link opens Billed with no error and no redirect`, async () => {
      const { container } = await open(`?tab=revenue&moneyTab=${old}`);
      expect(await screen.findByTestId("billed")).toBeTruthy();
      expect(within(container).queryByRole("button", { name: /unpaid/i })).toBeNull();
      expect(container.textContent ?? "").not.toMatch(/error|could not|moved/i);
      expect(new URL(window.location.href).searchParams.get("tab")).toBe("revenue");
    });
  }

  it("Financing shows the financing attribution and no Snap dashboard", async () => {
    const { container } = await open("?moneyTab=financing");
    expect(await screen.findByTestId("financing")).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(/snap/i);
    expect(screen.queryByTestId("billed")).toBeNull();
  });

  it("POSITIVE CONTROL: the URL does choose the tab (declined opens Declined, not the default)", async () => {
    await open("?moneyTab=declined");
    expect(await screen.findByTestId("declined")).toBeTruthy();
    expect(screen.queryByTestId("billed")).toBeNull();
  });

  it("the one action's Open in Declined switches the tab", async () => {
    await open("");
    fireEvent.click(await screen.findByTestId("next-estimate"));
    expect(await screen.findByTestId("declined")).toBeTruthy();
    expect(screen.queryByTestId("billed")).toBeNull();
    expect(new URL(window.location.href).searchParams.get("moneyTab")).toBe("declined");
  });
});
