/**
 * TireFinderV2 — coverage for the component that ACTUALLY SHIPS to /tires.
 *
 * Before this file, every tire test imported TireFinder's default export,
 * which resolved to TireFinderLegacy under `MODE === "test"` — so the live
 * V2 funnel had ZERO coverage. These tests exercise V2 directly and lock the
 * two bugs found in review: (1) the order modal must receive the REAL package
 * value (289), never 0; (2) no fabricated "Best value" badge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  search: { data: undefined as any, isLoading: false, isError: false },
}));

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  useLocation: () => ["/tires", vi.fn()],
  useSearch: () => window.location.search,
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: (_t, prop) => React.forwardRef((props: any, ref: any) => {
    const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, ...rest } = props;
    return React.createElement(typeof prop === "string" ? prop : "div", { ...rest, ref });
  }) }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
}));

vi.mock("@/lib/trpc", () => {
  const proc = (key: string) => ({
    useQuery: () =>
      key === "gatewayTire.publicSearch" ? h.search
        : key === "gatewayTire.getPackage" ? { data: { packageValuePerSet: 289, services: [] }, isLoading: false }
        : { data: undefined, isLoading: false },
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  });
  const trpc = new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext"
      ? () => ({})
      : new Proxy({}, { get: (_t2, p) => proc(`${String(ns)}.${String(p)}`) }),
  });
  return { trpc };
});

vi.mock("@/components/SEO", () => ({
  SEOHead: () => null,
  Breadcrumbs: () => null,
  trackEvent: (...a: any[]) => h.trackEvent(...a),
  trackPhoneClick: vi.fn(),
}));

// Stub the shared OrderModal so this test stays focused on V2's surface and
// can assert exactly what V2 passes into it (the packageValue bug fix).
vi.mock("@/pages/TireFinderLegacy", () => ({
  OrderModal: (props: any) =>
    React.createElement("div", {
      "data-testid": "order-modal",
      "data-package": String(props.packageValue),
      "data-qty": String(props.quantity),
    }, "modal"),
}));

const tire = (over: Partial<any>) => ({
  id: "t", name: "T", brand: "Brand", model: "Model", size: "215/60R16",
  category: "budget", shopPrice: 100, pricePerTireCents: 10000, warranty: "",
  features: [], speedRating: "", loadIndex: "", inStock: true, estimatedDelivery: "Same day",
  ...over,
});

async function renderV2() {
  const { default: TireFinderV2 } = await import("@/pages/TireFinderV2");
  render(React.createElement(TireFinderV2));
}

describe("TireFinderV2 (the shipped /tires funnel)", () => {
  beforeEach(() => {
    h.trackEvent.mockClear();
    h.search = { data: undefined, isLoading: false, isError: false };
    window.history.pushState({}, "", "/tires");
  });
  afterEach(cleanup);

  it("pre-search: shows the size search, popular shortcuts, and the 3 steps", async () => {
    await renderV2();
    expect(screen.getByLabelText("Search tire size")).toBeTruthy();
    expect(screen.getByText("215/60R16")).toBeTruthy(); // a popular shortcut
    expect(screen.getByText("1. Search your size")).toBeTruthy();
  });

  it("submitting a valid size fires tire_search_submitted", async () => {
    await renderV2();
    const input = screen.getByLabelText("Search tire size") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "225/65R17" } });
    fireEvent.click(screen.getByRole("button", { name: "Search tires" }));
    expect(h.trackEvent).toHaveBeenCalledWith("tire_search_submitted", expect.objectContaining({ size: "225/65R17" }));
  });

  it("renders results with honest labels + per-tire and set pricing — and NO 'Best value'", async () => {
    h.search = { data: { sizeFormatted: "215/60R16", source: "live", tires: [
      tire({ id: "a", brand: "Falken", model: "Sincera", category: "budget", shopPrice: 95.5 }),
      tire({ id: "b", brand: "Michelin", model: "Defender", category: "premium", shopPrice: 150 }),
    ] }, isLoading: false, isError: false };
    await renderV2();
    expect(screen.getByText("Lowest price")).toBeTruthy();       // #0, sorted price-low = honest
    expect(screen.getByText("Premium")).toBeTruthy();            // #1 uses REAL catalog category
    expect(screen.queryByText("Best value")).toBeNull();         // fabricated label is gone
    expect(screen.getByText("$95.50")).toBeTruthy();             // per-tire
    expect(screen.getByText("$382.00 for 4")).toBeTruthy();      // 95.5 × 4 (default qty)
  });

  it("changing quantity re-computes the set price", async () => {
    h.search = { data: { sizeFormatted: "215/60R16", source: "live", tires: [tire({ shopPrice: 100 })] }, isLoading: false, isError: false };
    await renderV2();
    expect(screen.getByText("$400.00 for 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2 tires" }));
    expect(screen.getByText("$200.00 for 2")).toBeTruthy();
  });

  it("requesting a tire opens the order modal with the REAL package value (289, not 0) and fires the event", async () => {
    h.search = { data: { sizeFormatted: "215/60R16", source: "live", tires: [tire({ id: "a", shopPrice: 120 })] }, isLoading: false, isError: false };
    await renderV2();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Request these" })); });
    const modal = screen.getByTestId("order-modal");
    expect(modal).toBeTruthy();
    expect(modal.getAttribute("data-package")).toBe("289"); // NOT "0" — the checkout bug fix
    expect(modal.getAttribute("data-qty")).toBe("4");
    expect(h.trackEvent).toHaveBeenCalledWith("tire_option_selected", expect.objectContaining({ id: "a", quantity: 4 }));
  });

  it("search error shows a call-the-shop fallback instead of a blank area", async () => {
    h.search = { data: undefined, isLoading: false, isError: true };
    await renderV2();
    expect(screen.getByText("We couldn't load options right now")).toBeTruthy();
  });

  it("empty results (size not stocked) shows the 'we can still find this' fallback", async () => {
    h.search = { data: { sizeFormatted: "999/99R99", source: "catalog", tires: [] }, isLoading: false, isError: false };
    await renderV2();
    expect(screen.getByText("We can still find this size")).toBeTruthy();
  });
});
