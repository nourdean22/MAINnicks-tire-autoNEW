/**
 * /tires "By vehicle" tab: year > make > model > trim through trpc.fitment.*,
 * then the chosen factory size runs the page's existing size search.
 * Every level has three honest outcomes: loading, an error with a retry, and a
 * real empty list. An upstream failure must never render as "no results".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  refetch: vi.fn(),
  status: { data: { available: true }, isLoading: false } as any,
  responses: {} as Record<string, any>,
  loading: new Set<string>(),
  calls: [] as Array<{ key: string; input: any; enabled: boolean }>,
  modalProps: null as any,
  search: { data: undefined, isLoading: false, isError: false } as any,
}));

vi.mock("sonner", () => {
  const plain = vi.fn();
  (plain as any).success = vi.fn();
  (plain as any).error = vi.fn();
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
    useQuery: (input: unknown, opts?: { enabled?: boolean }) => {
      if (key === "fitment.status") return h.status;
      if (key.startsWith("fitment.")) {
        const enabled = opts?.enabled !== false;
        h.calls.push({ key, input, enabled });
        if (!enabled) return { data: undefined, isLoading: false, isError: false, refetch: h.refetch };
        return { data: h.loading.has(key) ? undefined : h.responses[key], isLoading: h.loading.has(key), isError: false, refetch: h.refetch };
      }
      if (key === "gatewayTire.getPackage") return { data: { packageValuePerSet: 266 }, isLoading: false };
      if (key === "gatewayTire.publicSearch") return h.search;
      return { data: undefined, isLoading: false, isError: false };
    },
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

// Records what TireFinderV2 hands the order modal (the prefilled vehicle under test).
vi.mock("@/components/order/TireOrderModal", () => ({
  OrderModal: (props: any) => { h.modalProps = props; return null; },
}));

const YEARS = Array.from({ length: 2027 - 1980 + 1 }, (_, i) => 2027 - i);
const OK = {
  "fitment.years": { ok: true, years: YEARS },
  "fitment.makes": { ok: true, makes: [{ slug: "Honda", name: "Honda" }, { slug: "Alfa Romeo", name: "Alfa Romeo" }] },
  "fitment.models": { ok: true, models: [{ slug: "Civic", name: "Civic" }, { slug: "CR-V", name: "CR-V" }] },
  "fitment.trims": { ok: true, trims: [{ slug: "LX", label: "LX" }, { slug: "Type R", label: "Type R" }] },
  "fitment.sizes": { ok: true, sizes: [
    { size: "215/50R17", label: "215/50R17", rimDiameter: 17, rearSize: null, searchable: true },
    { size: "215/55R16", label: "215/55R16", rimDiameter: 16, rearSize: null, searchable: true },
    { size: "215/55R17", label: "215/55R17", rimDiameter: 17, rearSize: null, searchable: true },
    { size: "235/40R18", label: "235/40R18", rimDiameter: 18, rearSize: null, searchable: true },
  ] },
};

async function renderPage() {
  const { default: TireFinderV2 } = await import("@/pages/TireFinderV2");
  render(React.createElement(TireFinderV2));
}

const pick = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function pickVehicle() {
  pick("Year", "2018");
  pick("Make", "Honda");
  pick("Model", "Civic");
  pick("Trim", "LX");
}

describe("TireFinderV2 · By vehicle tab", () => {
  beforeEach(() => {
    h.trackEvent.mockClear();
    h.refetch.mockClear();
    h.status = { data: { available: true }, isLoading: false };
    h.responses = { ...OK };
    h.loading = new Set();
    h.calls = [];
    h.modalProps = null;
    h.search = { data: undefined, isLoading: false, isError: false };
    try { window.localStorage.clear(); } catch { /* jsdom always has it */ }
    window.history.pushState({}, "", "/tires");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("fitment unavailable: no vehicle tab, the size search shows on its own", async () => {
    h.status = { data: { available: false }, isLoading: false };
    await renderPage();
    expect(screen.queryByRole("tab", { name: "By vehicle" })).toBeNull();
    expect(screen.getByLabelText("Search tire size")).toBeTruthy();
  });

  it("status still loading: the vehicle tab shows a skeleton, not the selects", async () => {
    h.status = { data: undefined, isLoading: true };
    await renderPage();
    expect(screen.getByRole("tab", { name: "By vehicle" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByLabelText("Year")).toBeNull();
  });

  it("fitment available: By vehicle is the default tab; Make waits for a year and fires no query without one", async () => {
    await renderPage();
    expect(screen.getByRole("tab", { name: "By vehicle" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByLabelText("Search tire size")).toBeNull();
    expect((screen.getByLabelText("Year") as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByLabelText("Make") as HTMLSelectElement).disabled).toBe(true);
    expect(h.calls.some((c) => c.key === "fitment.makes" && c.enabled)).toBe(false);
  });

  it("a ?size= deep link opens the size tab on first render", async () => {
    window.history.pushState({}, "", "/tires?size=215/60R16");
    await renderPage();
    expect(screen.getByRole("tab", { name: "By size" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText("Search tire size") as HTMLInputElement).value).toBe("215/60R16");
  });

  it("?tab=size opens the size tab", async () => {
    window.history.pushState({}, "", "/tires?tab=size");
    await renderPage();
    expect(screen.getByRole("tab", { name: "By size" }).getAttribute("aria-selected")).toBe("true");
  });

  it("full path: year > make > model > trim shows the factory sizes; a tap runs the size search and keeps the vehicle in the URL", async () => {
    await renderPage();
    await pickVehicle();
    expect(h.trackEvent).toHaveBeenCalledWith("vehicle_search_step", { step: "year" });
    expect(h.trackEvent).toHaveBeenCalledWith("vehicle_search_step", { step: "trim" });
    expect(screen.getByRole("heading", { name: "Factory sizes for your 2018 Honda Civic LX" })).toBeTruthy();
    const sizes = screen.getByRole("group", { name: "Factory sizes for your 2018 Honda Civic LX" });
    expect(within(sizes).getAllByRole("button")).toHaveLength(4);
    const btn = within(sizes).getByRole("button", { name: /215\/55R16/ });
    expect(btn.textContent).toContain("16 in");

    fireEvent.click(btn);
    expect(h.trackEvent).toHaveBeenCalledWith("vehicle_size_selected", { size: "215/55R16", year: 2018, make: "Honda", model: "Civic" });
    expect(h.trackEvent).toHaveBeenCalledWith("tire_search_submitted", expect.objectContaining({ size: "215/55R16" }));
    const q = new URLSearchParams(window.location.search);
    expect(q.get("size")).toBe("215/55R16");
    expect([q.get("year"), q.get("make"), q.get("model"), q.get("trim")]).toEqual(["2018", "Honda", "Civic", "LX"]);
    expect(JSON.parse(window.localStorage.getItem("nick:vehicle")!)).toEqual({
      year: 2018, make: "Honda", model: "Civic", trim: "LX", label: "2018 Honda Civic LX",
    });
  });

  it("slugs go back to the server exactly as received (Alfa Romeo, Type R)", async () => {
    await renderPage();
    pick("Year", "2018");
    pick("Make", "Alfa Romeo");
    pick("Model", "Civic");
    pick("Trim", "Type R");
    const last = h.calls.filter((c) => c.key === "fitment.sizes" && c.enabled).at(-1);
    expect(last?.input).toEqual({ year: 2018, make: "Alfa Romeo", model: "Civic", trim: "Type R" });
  });

  it("upstream_error is an error with a retry, never an empty list", async () => {
    h.responses["fitment.makes"] = { ok: false, reason: "upstream_error" };
    await renderPage();
    pick("Year", "2018");
    expect(screen.getByText("We couldn't load vehicle data right now. Search by size below or call (216) 862-0005.")).toBeTruthy();
    expect(screen.queryByText(/No makes found/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it("rate_limited is handled exactly like upstream_error: the message and a Retry", async () => {
    h.responses["fitment.makes"] = { ok: false, reason: "rate_limited" };
    await renderPage();
    pick("Year", "2018");
    expect(screen.getByText("We couldn't load vehicle data right now. Search by size below or call (216) 862-0005.")).toBeTruthy();
    expect(screen.queryByText(/No makes found/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it("rate_limited at the size step also shows the message and Retry", async () => {
    h.responses["fitment.sizes"] = { ok: false, reason: "rate_limited" };
    await renderPage();
    await pickVehicle();
    expect(screen.getByText("We couldn't load vehicle data right now. Search by size below or call (216) 862-0005.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("the size button shows the label (LT kept); a non-searchable size is a call row, not a search button", async () => {
    h.responses["fitment.sizes"] = { ok: true, sizes: [
      { size: "245/75R16", label: "LT245/75R16", rimDiameter: 16, rearSize: null, searchable: true },
      { size: "31X10.50R15", label: "31X10.50R15", rimDiameter: 15, rearSize: null, searchable: false },
    ] };
    await renderPage();
    await pickVehicle();
    const group = screen.getByRole("group", { name: "Factory sizes for your 2018 Honda Civic LX" });
    const lt = within(group).getByRole("button", { name: /LT245\/75R16/ });
    expect(within(group).getAllByRole("button")).toHaveLength(1);
    const call = screen.getByRole("link", { name: "31X10.50R15: call us for this size" });
    expect(call.getAttribute("href")).toBe("tel:+12168620005");
    expect(call.className).toContain("min-h-12");
    fireEvent.click(lt);
    expect(new URLSearchParams(window.location.search).get("size")).toBe("245/75R16");
  });

  it("Change also drops the vehicle from the URL, keeping ?size, so a tab switch does not bring it back", async () => {
    window.history.pushState({}, "", "/tires?size=215/55R16&year=2018&make=Honda&model=Civic&trim=LX");
    await renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "By vehicle" }));
    expect(screen.getByText("Your 2018 Honda Civic LX")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const q = new URLSearchParams(window.location.search);
    expect(q.get("size")).toBe("215/55R16");
    expect(["year", "make", "model", "trim"].filter((k) => q.has(k))).toEqual([]);
    fireEvent.click(screen.getByRole("tab", { name: "By size" }));
    fireEvent.click(screen.getByRole("tab", { name: "By vehicle" }));
    expect(screen.queryByText("Your 2018 Honda Civic LX")).toBeNull();
    expect(screen.getByLabelText("Year")).toBeTruthy();
  });

  it("not_found at the size step says so and offers the call", async () => {
    h.responses["fitment.sizes"] = { ok: false, reason: "not_found" };
    await renderPage();
    await pickVehicle();
    expect(screen.getByText("No sizes found for that trim. Try another trim or call us.")).toBeTruthy();
  });

  it("an ok empty list says 'No models found' instead of a silent empty select", async () => {
    h.responses["fitment.models"] = { ok: true, models: [] };
    await renderPage();
    pick("Year", "2018");
    pick("Make", "Honda");
    expect(screen.getByText("No models found")).toBeTruthy();
  });

  it("unconfigured at any level drops back to the size search and hides the vehicle tab", async () => {
    h.responses["fitment.years"] = { ok: false, reason: "unconfigured" };
    await renderPage();
    expect(screen.queryByRole("tab", { name: "By vehicle" })).toBeNull();
    expect(screen.getByLabelText("Search tire size")).toBeTruthy();
  });

  it("while a level loads its select is disabled with a Loading... option", async () => {
    h.loading.add("fitment.years");
    await renderPage();
    const year = screen.getByLabelText("Year") as HTMLSelectElement;
    expect(year.disabled).toBe(true);
    expect(within(year).getByText("Loading...")).toBeTruthy();
  });

  it("a remembered vehicle shows 'Your 2018 Honda Civic LX' with its sizes; Change clears it", async () => {
    window.localStorage.setItem("nick:vehicle", JSON.stringify({ year: 2018, make: "Honda", model: "Civic", trim: "LX", label: "2018 Honda Civic LX" }));
    await renderPage();
    expect(screen.getByText("Your 2018 Honda Civic LX")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Factory sizes for your 2018 Honda Civic LX" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(window.localStorage.getItem("nick:vehicle")).toBeNull();
    expect(screen.queryByText("Your 2018 Honda Civic LX")).toBeNull();
    expect(screen.getByLabelText("Year")).toBeTruthy();
  });

  it("localStorage that throws (private mode) never breaks the picker", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    await renderPage();
    await pickVehicle();
    fireEvent.click(screen.getByRole("button", { name: /215\/55R16/ }));
    expect(new URLSearchParams(window.location.search).get("size")).toBe("215/55R16");
  });

  describe("the order modal gets the vehicle the customer picked (Codex P2 on PR 3148)", () => {
    const RESULTS = {
      data: { sizeFormatted: "215/55R16", source: "live", tires: [
        { id: "t1", name: "T", brand: "Falken", model: "Sincera", size: "215/55R16", category: "budget", shopPrice: 90,
          pricePerTireCents: 9000, warranty: "", features: [], speedRating: "", loadIndex: "", inStock: true, estimatedDelivery: "" },
      ] },
      isLoading: false,
      isError: false,
    };
    const CIVIC = { year: "2018", make: "Honda", model: "Civic", option: "LX", speeds: "" };
    const request = () => fireEvent.click(within(screen.getByRole("region", { name: "All tire options" })).getByRole("button", { name: "Request these" }));

    it("a By vehicle search prefills year, make, model and trim in the order modal", async () => {
      h.search = RESULTS;
      await renderPage();
      await pickVehicle();
      fireEvent.click(screen.getByRole("button", { name: /215\/55R16/ }));
      request();
      expect(h.modalProps.prefilledVehicle).toEqual(CIVIC);
    });

    it("a page re-render hands the modal the same vehicle object, so the customer's edits survive", async () => {
      h.search = RESULTS;
      await renderPage();
      await pickVehicle();
      fireEvent.click(screen.getByRole("button", { name: /215\/55R16/ }));
      request();
      const first = h.modalProps.prefilledVehicle;
      fireEvent.click(screen.getByRole("button", { name: "2 tires" })); // re-renders the page
      expect(h.modalProps.quantity).toBe(2);
      expect(h.modalProps.prefilledVehicle).toBe(first);
    });

    it("a By size search passes no vehicle, even after a vehicle search", async () => {
      h.search = RESULTS;
      await renderPage();
      await pickVehicle();
      fireEvent.click(screen.getByRole("button", { name: /215\/55R16/ }));
      fireEvent.click(screen.getByRole("tab", { name: "By size" }));
      fireEvent.change(screen.getByLabelText("Search tire size"), { target: { value: "215/55R16" } });
      fireEvent.click(screen.getByRole("button", { name: "Search tires" }));
      request();
      expect(h.modalProps.prefilledVehicle ?? null).toBeNull();
    });

    it("a reloaded vehicle search (?size plus the vehicle params) still prefills", async () => {
      h.search = RESULTS;
      window.history.pushState({}, "", "/tires?size=215/55R16&year=2018&make=Honda&model=Civic&trim=LX");
      await renderPage();
      request();
      expect(h.modalProps.prefilledVehicle).toEqual(CIVIC);
    });

    it("Change clears the vehicle the modal would get", async () => {
      h.search = RESULTS;
      window.history.pushState({}, "", "/tires?size=215/55R16&year=2018&make=Honda&model=Civic&trim=LX");
      await renderPage();
      fireEvent.click(screen.getByRole("tab", { name: "By vehicle" }));
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
      request();
      expect(h.modalProps.prefilledVehicle ?? null).toBeNull();
    });
  });
});
