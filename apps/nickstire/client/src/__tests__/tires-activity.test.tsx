/**
 * tires-activity.test.tsx · 2026-10-25 (job 2026-10-25-admin-tabs-tires)
 *
 * Admin > Tires opens on online tire activity for the last 30 days, with the coverage stated in plain
 * text (counter tire sales and installs are not measured), then the website's orders as one short list
 * (every status by default, so a lone installed order is never hidden behind an empty board), then the
 * markup card, which reads back the saved value, who set it and when, before it lets anyone replace it.
 * A failed read is unknown, never 0; a missing event is "Not tracked", never 0.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown; isFetching: boolean };
type MutOpts = { onSuccess?: (res: unknown, input: unknown) => void; onError?: (err: Error) => void };

const h = vi.hoisted(() => ({
  queries: new Map<string, Partial<Q>>(),
  mutations: new Map<string, unknown[]>(),
  answers: new Map<string, unknown>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => Promise.resolve({}),
    isFetching: false,
    ...h.queries.get(path),
  });
  const mutation = (path: string) => (opts?: MutOpts) => ({
    mutate: (input: unknown) => {
      h.mutations.set(path, [...(h.mutations.get(path) ?? []), input]);
      if (h.answers.has(path)) opts?.onSuccess?.(h.answers.get(path), input);
    },
    mutateAsync: async () => ({}),
    isPending: false,
    variables: undefined,
    reset: () => {},
  });
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery") return query(path);
        if (key === "useMutation") return mutation(path);
        return node(path ? `${path}.${String(key)}` : String(key));
      },
      apply() {
        return undefined;
      },
    });
  const root = new Proxy({}, {
    get(_t, key) {
      if (key === "useUtils" || key === "useContext") return () => node("utils");
      return node(String(key));
    },
  });
  return { trpc: root };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: h.toastSuccess, error: h.toastError, info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: async () => true, default: () => null }));

import TireOrdersSection from "@/pages/admin/TireOrdersSection";
import TireMarkupCard from "@/components/admin/TireMarkupCard";

const SUMMARY = "customerEvents.summary";
const LIST = "gatewayTire.listOrders";
const STATS = "gatewayTire.orderStats";
const MARKUP = "gatewayTire.markup";
const SAVE = "gatewayTire.updateMarkup";

const TOTALS = {
  totals: [
    { eventName: "tire_quote_cta_click", count: 396 },
    { eventName: "tire_search_submitted", count: 75 },
    { eventName: "vehicle_size_selected", count: 14 },
    { eventName: "tire_option_selected", count: 9 },
    { eventName: "photo_ribbon_view", count: 1200 },
  ],
  recent: [],
  days: 30,
};
const INSTALLED = {
  id: 7, orderNumber: "TO-20261020-007", status: "installed", statusLabel: "Installed", paymentStatus: "paid",
  customerName: "Test Customer", customerPhone: "2165550000", tireBrand: "Michelin", tireModel: "Defender",
  tireSize: "215/60R16", quantity: 4, pricePerTire: 96, totalAmount: 384, invoiceNumber: null, gatewayOrderRef: null,
  vehicleInfo: null, customerNotes: null, adminNotes: null, expectedDelivery: null, installationDate: null,
  createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
};
const STATS_LIVE = { total: 1, received: 0, confirmed: 0, ordered: 0, inTransit: 0, delivered: 0, scheduled: 0, installed: 1, cancelled: 0, totalRevenue: 384 };
const OWNER = { data: { adminRole: "owner", permissions: [] } };
const SAVED = { available: true, percent: 100, updatedAt: "2026-10-25T18:00:00.000Z", updatedBy: "nour@example.com", note: null };
const NEVER = { available: true, percent: null, updatedAt: null, updatedBy: null, note: null };
const FAILED = { available: false, reason: "error", message: "boom" };

function setup(over: Record<string, Partial<Q>> = {}) {
  h.queries.set("adminSecurity.status", OWNER);
  h.queries.set(SUMMARY, { data: TOTALS });
  h.queries.set(LIST, { data: { orders: [INSTALLED], total: 1 } });
  h.queries.set(STATS, { data: STATS_LIVE });
  h.queries.set(MARKUP, { data: SAVED });
  for (const [k, v] of Object.entries(over)) h.queries.set(k, v);
}

afterEach(() => {
  cleanup();
  h.queries.clear();
  h.mutations.clear();
  h.answers.clear();
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

const strip = () => within(screen.getByRole("region", { name: "Online tire activity, last 30 days" }));
const tile = (label: string) => strip().getByText(label).closest("div")!;

describe("Tires: online tire activity strip", () => {
  it("shows each tire event's 30-day count, and the orders with their window and the lifetime count", () => {
    setup();
    render(<TireOrdersSection />);
    expect(tile("Tire-size searches").textContent).toContain("75");
    expect(tile("Quote taps").textContent).toContain("396");
    expect(tile("Quote taps").textContent).toMatch(/a tap, not a quote/);
    expect(tile("Sizes picked").textContent).toContain("14");
    expect(tile("Options picked").textContent).toContain("9");
    expect(tile("Online orders").textContent).toMatch(/1 in 30 days/);
    expect(tile("Online orders").textContent).toMatch(/1 lifetime/);
    // Counts only, no stage percentages: the events are not one linked journey.
    expect(strip().queryByText(/%/)).toBeNull();
  });

  it("an event the summary did not return reads Not tracked, never 0", () => {
    setup({ [SUMMARY]: { data: { ...TOTALS, totals: TOTALS.totals.filter((t) => t.eventName !== "tire_option_selected") } } });
    render(<TireOrdersSection />);
    expect(tile("Options picked").textContent).toContain("Not tracked");
    expect(tile("Options picked").textContent).not.toMatch(/\b0\b/);
  });

  it("states the coverage in plain text under the strip", () => {
    setup();
    render(<TireOrdersSection />);
    expect(screen.getByText(/Website activity only\. Counter tire sales and installs are not measured: ShopDriver's invoice line items are not connected\. Online orders are not the shop's tire sales\./)).toBeTruthy();
  });

  it("a failed activity read is unknown with Retry, and shows no counts", () => {
    const refetch = vi.fn();
    setup({ [SUMMARY]: { isError: true, error: { message: "down" }, refetch } });
    render(<TireOrdersSection />);
    const region = strip();
    expect(region.getByText("Activity couldn't load: unknown.")).toBeTruthy();
    expect(region.queryByText("Tire-size searches")).toBeNull();
    const retry = region.getByRole("button", { name: "Retry" });
    expect(retry.className).toMatch(/min-h-12/);
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalled();
  });

  it("an empty event payload (the summary's dead-database answer) is unknown, not a row of Not tracked", () => {
    setup({ [SUMMARY]: { data: { totals: [], recent: [], days: 30 } } });
    render(<TireOrdersSection />);
    expect(strip().getByText(/No website events came back for the last 30 days: unknown/)).toBeTruthy();
    expect(strip().queryByText("Not tracked")).toBeNull();
  });

  it("a saved quote (TQ- row, which listOrders also returns) is not counted as an online order", () => {
    const quote = { ...INSTALLED, id: 8, orderNumber: "TQ-20261021-008", status: "received", statusLabel: "New request" };
    setup({ [LIST]: { data: { orders: [quote, INSTALLED], total: 2 } } });
    render(<TireOrdersSection />);
    expect(tile("Online orders").textContent).toMatch(/^Online orders1 in 30 days/);
  });

  it("a failed order-count read is unknown on the strip, never 0", () => {
    setup({ [STATS]: { isError: true, error: { message: "Database unavailable" } } });
    render(<TireOrdersSection />);
    expect(tile("Online orders").textContent).toMatch(/lifetime unknown/);
    expect(tile("Online orders").textContent).not.toMatch(/\b0 lifetime/);
  });
});

describe("Tires: the online orders list", () => {
  it("opens on Tires with the plain title, no Command Center, no nine-tab bar, one status filter", () => {
    setup();
    render(<TireOrdersSection />);
    expect(screen.getByRole("heading", { name: "Tires" })).toBeTruthy();
    expect(screen.queryByText(/Command Center/)).toBeNull();
    expect(screen.queryByRole("button", { name: /New Requests/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Active Orders/ })).toBeNull();
    const filter = screen.getByRole("combobox", { name: "Order status" }) as HTMLSelectElement;
    expect(filter.value).toBe("all");
    expect(within(filter).getByRole("option", { name: "All statuses" })).toBeTruthy();
    expect(filter.className).toMatch(/min-h-12/);
  });

  it("the default view lists an installed order instead of an empty board", () => {
    setup();
    render(<TireOrdersSection />);
    expect(screen.getByText("TO-20261020-007")).toBeTruthy();
    expect(screen.queryByText(/No online orders/)).toBeNull();
  });

  it("an empty list says so with the real lifetime count", () => {
    setup({ [LIST]: { data: { orders: [], total: 0 } }, [STATS]: { data: { ...STATS_LIVE, total: 3 } } });
    render(<TireOrdersSection />);
    expect(screen.getByText("No online orders match this view. 3 online orders recorded lifetime.")).toBeTruthy();
  });

  it("a failed order list is unknown with Retry, never 'no orders'", () => {
    const refetch = vi.fn();
    setup({ [LIST]: { isError: true, error: { message: "Database unavailable" }, refetch } });
    render(<TireOrdersSection />);
    expect(screen.getByText("Online orders couldn't load: unknown, not empty.")).toBeTruthy();
    expect(screen.queryByText(/No online orders/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading orders" }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("TireMarkupCard reads back the saved value before a save", () => {
  it("saved: the percent, when, by whom, and the scope; the input starts at it; nothing to save yet", () => {
    setup();
    render(<TireMarkupCard />);
    expect(screen.getByText(
      "Current online tire markup: 100% over wholesale (100 means cost times 2) · set Oct 25 by nour · website tire prices only; does not change the counter's prices.",
    )).toBeTruthy();
    const input = screen.getByLabelText("Markup percent") as HTMLInputElement;
    expect(input.value).toBe("100");
    expect(input.className).toMatch(/h-12/);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.className).toMatch(/min-h-12/);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("never saved: says the pricing path uses its built-in default, and shows no percent", () => {
    setup({ [MARKUP]: { data: NEVER } });
    render(<TireMarkupCard />);
    expect(screen.getByText(/No online markup saved yet; the pricing path uses its built-in default\./)).toBeTruthy();
    expect((screen.getByLabelText("Markup percent") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/Current online tire markup/)).toBeNull();
  });

  it.each([
    ["the read answered unavailable", { data: FAILED }],
    ["the read threw", { isError: true, error: { message: "Database unavailable" } }],
  ])("failed read (%s): unknown, and Save stays disabled even with a valid number typed", (_label, q) => {
    setup({ [MARKUP]: q as Partial<Q> });
    render(<TireMarkupCard />);
    expect(screen.getByText("Current markup unknown: couldn't load.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Markup percent"), { target: { value: "110" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("an edit shows Unsaved changes; Save sends the number and the card re-reads", async () => {
    const refetch = vi.fn().mockResolvedValue({});
    setup({ [MARKUP]: { data: SAVED, refetch } });
    h.answers.set(SAVE, { ...SAVED, percent: 110 });
    render(<TireMarkupCard />);
    fireEvent.change(screen.getByLabelText("Markup percent"), { target: { value: "110" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => { fireEvent.click(save); });
    expect(h.mutations.get(SAVE)).toEqual([{ markup: 110 }]);
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(h.toastSuccess).toHaveBeenCalledWith("Markup saved: 110%");
  });

  it("a save whose read-back failed says saved but unknown, never a saved percent", async () => {
    setup({ [MARKUP]: { data: SAVED, refetch: vi.fn().mockResolvedValue({}) } });
    h.answers.set(SAVE, FAILED);
    render(<TireMarkupCard />);
    fireEvent.change(screen.getByLabelText("Markup percent"), { target: { value: "120" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(h.mutations.get(SAVE)).toEqual([{ markup: 120 }]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(await screen.findByText(/Saved, but the new value couldn't be read back: unknown\./)).toBeTruthy();
  });
});
