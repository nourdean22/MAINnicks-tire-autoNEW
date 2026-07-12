/**
 * TireFinderV2 — coverage for the component that ACTUALLY SHIPS to /tires.
 *
 * Before this file, every tire test imported TireFinder's default export,
 * which resolved to TireFinderLegacy under `MODE === "test"` — so the live
 * V2 funnel had ZERO coverage. These tests exercise V2 directly and lock the
 * two bugs found in review: (1) the order modal must receive the REAL package
 * value (266), never 0; (2) no fabricated "Best value" badge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  search: { data: undefined as any, isLoading: false, isError: false },
  confirmMutate: vi.fn(),
  confirmResult: { ok: true } as { ok: boolean },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastPlain: vi.fn(),
}));

vi.mock("sonner", () => {
  const plain = (...a: unknown[]) => h.toastPlain(...a);
  (plain as any).success = (...a: unknown[]) => h.toastSuccess(...a);
  (plain as any).error = (...a: unknown[]) => h.toastError(...a);
  return { toast: plain };
});

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
        : key === "gatewayTire.getPackage" ? { data: { packageValuePerSet: 266, services: [] }, isLoading: false }
        : { data: undefined, isLoading: false },
    useMutation: () =>
      key === "gatewayTire.confirmCheckout"
        ? {
            mutate: (vars: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
              h.confirmMutate(vars);
              opts?.onSuccess?.(h.confirmResult);
            },
            isPending: false,
          }
        : { mutate: vi.fn(), isPending: false },
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
vi.mock("@/components/order/TireOrderModal", () => ({
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
    h.confirmMutate.mockClear();
    h.toastSuccess.mockClear();
    h.toastError.mockClear();
    h.toastPlain.mockClear();
    h.confirmResult = { ok: true };
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

  it("initializes the search input from ?size on mount (shared-link entry)", async () => {
    window.history.pushState({}, "", "/tires?size=225/65R17");
    await renderV2();
    const input = screen.getByLabelText("Search tire size") as HTMLInputElement;
    expect(input.value).toBe("225/65R17");
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

  it("cards show real feed specs (load+speed rating) and a live in-stock chip", async () => {
    h.search = { data: { sizeFormatted: "215/60R16", source: "live", tires: [
      tire({ id: "a", brand: "Landsail", model: "RD3", loadIndex: "94", speedRating: "H", inStock: true, estimatedDelivery: "Same day" }),
    ] }, isLoading: false, isError: false };
    await renderV2();
    expect(screen.getByText("94H")).toBeTruthy();                 // disambiguates variants
    expect(screen.getByText("In stock · Same day")).toBeTruthy();
  });

  it("out-of-stock tire shows 'Available to order' with its lead time", async () => {
    h.search = { data: { sizeFormatted: "215/60R16", source: "live", tires: [
      tire({ id: "b", inStock: false, estimatedDelivery: "1-2 business days" }),
    ] }, isLoading: false, isError: false };
    await renderV2();
    expect(screen.getByText("Available to order · 1-2 business days")).toBeTruthy();
    expect(screen.queryByText(/In stock/)).toBeNull();
  });

  it("changing quantity re-computes the set price", async () => {
    h.search = { data: { sizeFormatted: "215/60R16", source: "live", tires: [tire({ shopPrice: 100 })] }, isLoading: false, isError: false };
    await renderV2();
    expect(screen.getByText("$400.00 for 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2 tires" }));
    expect(screen.getByText("$200.00 for 2")).toBeTruthy();
  });

  it("requesting a tire opens the order modal with the REAL package value (266, not 0) and fires the event", async () => {
    h.search = { data: { sizeFormatted: "215/60R16", source: "live", tires: [tire({ id: "a", shopPrice: 120 })] }, isLoading: false, isError: false };
    await renderV2();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Request these" })); });
    const modal = screen.getByTestId("order-modal");
    expect(modal).toBeTruthy();
    expect(modal.getAttribute("data-package")).toBe("266"); // NOT "0" — the checkout bug fix ($266 = itemized sum)
    expect(modal.getAttribute("data-qty")).toBe("4");
    expect(h.trackEvent).toHaveBeenCalledWith("tire_option_selected", expect.objectContaining({ id: "a", quantity: 4 }));
  });

  it("invalid (short) size submit shows an inline error instead of silently doing nothing", async () => {
    await renderV2();
    const input = screen.getByLabelText("Search tire size") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "215" } });
    fireEvent.click(screen.getByRole("button", { name: "Search tires" }));
    expect(screen.getByRole("alert").textContent).toMatch(/size looks incomplete/i);
    expect(h.trackEvent).not.toHaveBeenCalledWith("tire_search_submitted", expect.anything());
    // Typing again clears the error.
    fireEvent.change(input, { target: { value: "215/60R16" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Stripe success return (?paid=1&order=X) confirms server-side, toasts, and strips the URL", async () => {
    h.confirmResult = { ok: true };
    window.history.pushState({}, "", "/tires?order=TO-20260712-123&paid=1");
    await renderV2();
    expect(h.confirmMutate).toHaveBeenCalledWith({ orderNumber: "TO-20260712-123" });
    expect(h.toastSuccess).toHaveBeenCalledWith(expect.stringContaining("TO-20260712-123"));
    expect(window.location.search).not.toMatch(/paid|order/);
  });

  it("Stripe success return with UNVERIFIED payment shows the call-us error, not a fake success", async () => {
    h.confirmResult = { ok: false };
    window.history.pushState({}, "", "/tires?order=TO-20260712-124&paid=1");
    await renderV2();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining("couldn't verify payment"));
  });

  it("Stripe cancel return (?paid=0) tells the customer the order is saved", async () => {
    window.history.pushState({}, "", "/tires?order=TO-20260712-125&paid=0");
    await renderV2();
    expect(h.confirmMutate).not.toHaveBeenCalled();
    expect(h.toastPlain).toHaveBeenCalledWith(expect.stringContaining("still saved"));
    expect(window.location.search).not.toMatch(/paid|order/);
  });

  it("results header carries the payment-programs reassurance line (line only — no pressure block)", async () => {
    h.search = { data: { sizeFormatted: "215/60R16", source: "live", tires: [tire({})] }, isLoading: false, isError: false };
    await renderV2();
    expect(screen.getByText(/Payment programs are available if you need them/i)).toBeTruthy();
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
