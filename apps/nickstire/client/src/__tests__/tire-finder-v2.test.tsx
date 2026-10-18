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
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  search: { data: undefined as any, isLoading: false, isError: false },
  confirmMutate: vi.fn(),
  confirmResult: { ok: true } as { ok: boolean },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastPlain: vi.fn(),
  trackApplication: vi.fn(),
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
        : key === "financing.trackApplication"
          ? { mutate: (...a: unknown[]) => h.trackApplication(...a), isPending: false }
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

// The Kafene CTA must read its URL from shared/financing; a sentinel URL here
// fails any hard-coded copy of the real link.
const KAFENE_TEST_URL = "https://kafene.test/apply-from-shared";
vi.mock("@shared/financing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/financing")>();
  return {
    ...actual,
    FINANCING_PROVIDERS: actual.FINANCING_PROVIDERS.map((p) => (p.id === "kafene" ? { ...p, applyUrl: KAFENE_TEST_URL } : p)),
  };
});

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

// The full result list and the top-pick cards show some of the same tires,
// so list assertions are scoped to the list region.
const list = () => within(screen.getByRole("region", { name: "All tire options" }));
const picks = () => screen.queryByRole("region", { name: "Top picks" });
const results = (tires: any[]) => ({
  data: { sizeFormatted: "215/60R16", source: "live", tires }, isLoading: false, isError: false,
});

// Sorted price-low, as publicSearch returns it. Spans all three tiers.
const SIX = [
  tire({ id: "b1", brand: "Falken", model: "Sincera", category: "budget", shopPrice: 70 }),
  tire({ id: "b2", brand: "Kumho", model: "Solus", category: "budget", shopPrice: 75 }),
  tire({ id: "m1", brand: "Hankook", model: "Kinergy", category: "mid", shopPrice: 88 }),
  tire({ id: "m2", brand: "Cooper", model: "CS5", category: "mid", shopPrice: 92 }),
  tire({ id: "p1", brand: "Michelin", model: "Defender", category: "premium", shopPrice: 140 }),
  tire({ id: "p2", brand: "Bridgestone", model: "Turanza", category: "premium", shopPrice: 160 }),
];

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
    expect(list().getByText("Lowest price")).toBeTruthy();       // #0, sorted price-low = honest
    expect(list().getByText("Premium")).toBeTruthy();            // #1 uses REAL catalog category
    expect(screen.queryByText("Best value")).toBeNull();         // no mid-range tire -> no "Best value" anywhere
    expect(list().getByText("$95.50")).toBeTruthy();             // per-tire
    expect(list().getByText("$382.00 for 4")).toBeTruthy();      // 95.5 × 4 (default qty)
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
    expect(list().getByText("$400.00 for 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2 tires" }));
    expect(list().getByText("$200.00 for 2")).toBeTruthy();
  });

  it("requesting a tire opens the order modal with the REAL package value (266, not 0) and fires the event", async () => {
    h.search = { data: { sizeFormatted: "215/60R16", source: "live", tires: [tire({ id: "a", shopPrice: 120 })] }, isLoading: false, isError: false };
    await renderV2();
    await act(async () => { fireEvent.click(list().getByRole("button", { name: "Request these" })); });
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

  describe("top picks above the results", () => {
    const card = (label: string) => {
      const region = picks();
      expect(region).not.toBeNull();
      const found = within(region!).getAllByRole("article").find((a) => within(a).queryByText(label));
      expect(found, `no top-pick card labelled ${label}`).toBeTruthy();
      return within(found!);
    };

    it("6 tires across tiers: three cards with the right tire and set-of-4 total each", async () => {
      h.search = results(SIX);
      await renderV2();
      expect(within(picks()!).getAllByRole("article")).toHaveLength(3);
      expect(card("Lowest price").getByText("Falken Sincera")).toBeTruthy();
      expect(card("Lowest price").getByText("$70.00")).toBeTruthy();
      expect(card("Lowest price").getByText("$280.00 for 4")).toBeTruthy();
      expect(card("Best value").getByText("Hankook Kinergy")).toBeTruthy();
      expect(card("Best value").getByText("$352.00 for 4")).toBeTruthy();
      expect(card("Premium").getByText("Michelin Defender")).toBeTruthy();
      expect(card("Premium").getByText("$560.00 for 4")).toBeTruthy();
      // The full list is still below, unchanged.
      expect(list().getAllByRole("article")).toHaveLength(6);
    });

    it("card totals follow the quantity selector, same math as the list", async () => {
      h.search = results(SIX);
      await renderV2();
      fireEvent.click(screen.getByRole("button", { name: "2 tires" }));
      expect(card("Premium").getByText("$280.00 for 2")).toBeTruthy();
      expect(list().getByText("$280.00 for 2")).toBeTruthy(); // p1 in the list agrees
    });

    it("2 tires (no mid-range): only two cards, no empty or 'Best value' card", async () => {
      h.search = results([
        tire({ id: "a", brand: "Falken", model: "Sincera", category: "budget", shopPrice: 95.5 }),
        tire({ id: "b", brand: "Michelin", model: "Defender", category: "premium", shopPrice: 150 }),
      ]);
      await renderV2();
      const cards = within(picks()!).getAllByRole("article");
      expect(cards).toHaveLength(2);
      expect(within(picks()!).queryByText("Best value")).toBeNull();
      expect(picks()!.textContent).not.toMatch(/\$0\.00|NaN/);
    });

    it("0 tires: no top-picks section, the call-the-shop fallback still shows", async () => {
      h.search = { data: { sizeFormatted: "999/99R99", source: "catalog", tires: [] }, isLoading: false, isError: false };
      await renderV2();
      expect(picks()).toBeNull();
      expect(screen.getByText("We can still find this size")).toBeTruthy();
    });

    it("requesting from a card opens the order modal for that tire and fires top_pick_selected", async () => {
      h.search = results(SIX);
      await renderV2();
      await act(async () => { fireEvent.click(card("Best value").getByRole("button", { name: "Request these" })); });
      expect(screen.getByTestId("order-modal").getAttribute("data-qty")).toBe("4");
      expect(h.trackEvent).toHaveBeenCalledWith("top_pick_selected", { pick: "value", size: "215/60R16" });
    });

    it("each card has a call link to the shop phone", async () => {
      h.search = results(SIX);
      await renderV2();
      const call = card("Premium").getByRole("link", { name: "Call about these tires" });
      expect(call.getAttribute("href")).toBe("tel:+12168620005");
      fireEvent.click(call);
      expect(h.trackEvent).toHaveBeenCalledWith("quote_call_clicked", { pick: "premium", size: "215/60R16" });
    });

    it("next to each total: Apply with Kafene (new tab) and More payment programs (/financing)", async () => {
      h.search = results(SIX);
      await renderV2();
      const kafene = card("Premium").getByRole("link", { name: "Apply with Kafene (opens in a new tab)" });
      expect(kafene.getAttribute("href")).toBe(KAFENE_TEST_URL); // from shared/financing, not hard-coded
      expect(kafene.getAttribute("target")).toBe("_blank");
      expect(kafene.getAttribute("rel")).toContain("noopener");
      expect(kafene.className).toContain("min-h-12");
      fireEvent.click(kafene);
      expect(h.trackEvent).toHaveBeenCalledWith("payment_programs_clicked", { provider: "kafene" });

      const more = card("Premium").getByRole("link", { name: "More payment programs" });
      expect(more.getAttribute("href")).toBe("/financing");
      fireEvent.click(more);
      expect(h.trackEvent).toHaveBeenCalledWith("payment_programs_clicked", { provider: "more" });
      // Brand rule: the customer never reads the word "financing".
      expect(picks()!.textContent).not.toMatch(/financ/i);
    });

    it("a Kafene banner sits directly under the top picks: 320x50 on phones, 728x90 from md up", async () => {
      h.search = results(SIX);
      await renderV2();
      const img = screen.getByAltText("Kafene: get up to $5,000 today, low lease payments and no credit needed. Apply now.") as HTMLImageElement;
      expect(img.getAttribute("src")).toBe("/kafene/kafene-320x50.png");
      expect([img.getAttribute("width"), img.getAttribute("height"), img.getAttribute("loading")]).toEqual(["320", "50", "lazy"]);
      const source = img.closest("picture")!.querySelector("source")!;
      expect(source.getAttribute("srcset")).toBe("/kafene/kafene-728x90.png");
      expect(source.getAttribute("media")).toBe("(min-width: 768px)");
      const link = img.closest("a")!;
      expect(link.getAttribute("href")).toBe(KAFENE_TEST_URL);
      expect(link.getAttribute("target")).toBe("_blank");
      // Directly under the picks region, before the full list.
      expect(picks()!.nextElementSibling).toBe(link);
    });

    it.each([
      ["the top-pick link", () => within(picks()!).getAllByRole("link", { name: "Apply with Kafene (opens in a new tab)" })[0]],
      ["the banner", () => screen.getByAltText(/^Kafene:/).closest("a")!],
    ])("a Kafene click on %s records the apply via financing.trackApplication, fire-and-forget", async (_where, target) => {
      h.trackApplication.mockReset();
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
      h.search = results(SIX);
      await renderV2();
      expect(fireEvent.click(target())).toBe(true); // the link still opens
      expect(h.trackApplication).toHaveBeenCalledTimes(1);
      const [vars, opts] = h.trackApplication.mock.calls[0] as [Record<string, unknown>, { onError?: (e: unknown) => void } | undefined];
      expect(vars).toMatchObject({ provider: "kafene", sourcePage: "/tires" });
      expect(opts?.onError).toBeTypeOf("function");
      expect(() => opts!.onError!(new Error("BAD_REQUEST"))).not.toThrow();
      expect(debug).toHaveBeenCalled();
      debug.mockRestore();
    });

    it("a trackApplication call that throws on the spot never blocks the Kafene link", async () => {
      h.trackApplication.mockReset().mockImplementation(() => { throw new Error("client not ready"); });
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
      h.search = results(SIX);
      await renderV2();
      const reported: unknown[] = [];
      const onError = (e: ErrorEvent) => { reported.push(e.error); e.preventDefault(); };
      window.addEventListener("error", onError);
      let opened = false;
      try {
        opened = fireEvent.click(screen.getByAltText(/^Kafene:/).closest("a")!);
      } finally {
        window.removeEventListener("error", onError);
        h.trackApplication.mockReset();
        debug.mockRestore();
      }
      expect(reported).toEqual([]);
      expect(opened).toBe(true);
    });

    it("no Kafene banner when there are no results", async () => {
      h.search = { data: { sizeFormatted: "999/99R99", source: "catalog", tires: [] }, isLoading: false, isError: false };
      await renderV2();
      expect(screen.queryByAltText(/^Kafene:/)).toBeNull();
    });

    it("no text-this-quote link: shared/business.ts documents no SMS-capable number", async () => {
      h.search = results(SIX);
      await renderV2();
      expect(picks()!.querySelector('a[href^="sms:"]')).toBeNull();
    });
  });
});
