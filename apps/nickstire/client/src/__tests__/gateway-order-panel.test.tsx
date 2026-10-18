/**
 * Admin Tire Orders: "Order from D&K" (gatewayOrder v1, server/routers/gatewayOrder.ts).
 * Prepare shows the D&K cart lines; Submit only after the house ConfirmDialog; every ok:false
 * reason is one plain sentence, never an empty table. Spends the shop's money, so the panel is
 * hidden unless the admin holds money.manage. The real ConfirmDialog host is mounted beside the
 * section, as the admin shell does in production.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  security: { data: { adminRole: "owner" } as any, isLoading: false, isError: false },
  kafeneStatus: { data: undefined as any, isLoading: false, isError: false },
  orders: [] as any[],
  prepare: vi.fn(),
  submit: vi.fn(),
  clearOurLines: vi.fn(),
  invalidateList: vi.fn(),
  invalidateStats: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

vi.mock("framer-motion", () => {
  const cache = new Map<string, unknown>();
  const motion = new Proxy({}, {
    get: (_t, prop) => {
      const tag = typeof prop === "string" ? prop : "div";
      if (!cache.has(tag)) {
        cache.set(tag, React.forwardRef((props: any, ref: any) => {
          const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, layout, ...rest } = props;
          return React.createElement(tag, { ...rest, ref });
        }));
      }
      return cache.get(tag);
    },
  });
  return { motion, AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children) };
});

vi.mock("@/lib/trpc", () => {
  const proc = (key: string) => ({
    useQuery: () => {
      if (key === "adminSecurity.status") return h.security;
      if (key === "kafene.status") return h.kafeneStatus;
      if (key === "gatewayTire.listOrders") return { data: { orders: h.orders }, isLoading: false, isError: false, refetch: vi.fn() };
      if (key === "gatewayTire.orderStats") return { data: {}, isError: false, refetch: vi.fn() };
      return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    },
    useMutation: () => {
      const fn = key === "gatewayOrder.prepare" ? h.prepare : key === "gatewayOrder.submit" ? h.submit : key === "gatewayOrder.clearOurLines" ? h.clearOurLines : vi.fn();
      return { mutate: vi.fn(), mutateAsync: (...a: any[]) => fn(...a), isPending: false };
    },
  });
  const utils = {
    gatewayTire: {
      listOrders: { invalidate: (...a: any[]) => h.invalidateList(...a) },
      orderStats: { invalidate: (...a: any[]) => h.invalidateStats(...a) },
    },
  };
  const trpc = new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext" ? () => utils : new Proxy({}, { get: (_t2, p) => proc(`${String(ns)}.${String(p)}`) }),
  });
  return { trpc };
});

const PAID = {
  id: 42, orderNumber: "TO-20261018-042", status: "received", paymentStatus: "paid", gatewayOrderRef: null,
  customerName: "Test Customer", customerPhone: "2165550000", tireBrand: "Michelin", tireModel: "Defender",
  tireSize: "215/60R16", quantity: 4, pricePerTireCents: 15000, createdAt: new Date().toISOString(),
  // Fields TireOrdersSection itself renders (listOrders returns them in dollars).
  pricePerTire: 150, totalAmount: 600, statusLabel: "New request", invoiceNumber: null, vehicleInfo: null,
  customerNotes: null, adminNotes: null, expectedDelivery: null, installationDate: null,
};
const MATCH = { partNumber: "MIC12345", brand: "Michelin", model: "Defender T+H", size: "215/60R16", wholesaleCents: 9600, qtyAvailable: 12 };
const LINE = { partNumber: "MIC12345", description: "MICHELIN DEFENDER T+H 215/60R16", quantity: 4, unitCostCents: 9600, lineTotalCents: 38400, poNumber: "online order TO-20261018-042" };
const TOKEN = "a".repeat(64);
const PREPARED = { ok: true, preview: false, match: MATCH, lines: [LINE], cartHadOtherLines: false, cutoff: "Order by 3 PM for next-day delivery", cartToken: TOKEN };

async function renderPanel(order: any = PAID) {
  const { default: GatewayOrderPanel } = await import("@/components/admin/GatewayOrderPanel");
  const { default: ConfirmDialog } = await import("@/components/admin/ConfirmDialog");
  render(React.createElement(React.Fragment, null,
    React.createElement(GatewayOrderPanel, { order }),
    React.createElement(ConfirmDialog)));
}

const prepareButton = () => screen.queryByRole("button", { name: "Prepare D&K order" });
const panel = () => within(screen.getByRole("region", { name: "Order from D&K" }));

async function prepare() {
  await act(async () => { fireEvent.click(prepareButton()!); });
}

describe("GatewayOrderPanel", () => {
  beforeEach(() => {
    h.security = { data: { adminRole: "owner" }, isLoading: false, isError: false };
    h.kafeneStatus = { data: undefined, isLoading: false, isError: false };
    h.prepare.mockReset().mockResolvedValue(PREPARED);
    h.submit.mockReset().mockResolvedValue({ ok: true, gatewayOrderRef: "DK-778899", submittedAt: "2026-10-18T15:00:00Z" });
    h.clearOurLines.mockReset().mockResolvedValue({ ok: true, removed: 1 });
    h.invalidateList.mockReset();
    h.invalidateStats.mockReset();
  });
  afterEach(cleanup);

  it.each([
    ["an unpaid order", { paymentStatus: "pending" }],
    ["an order that already has a D&K reference", { gatewayOrderRef: "DK-1" }],
    ["an order past confirmed", { status: "ordered" }],
  ])("is absent for %s", async (_label, over) => {
    await renderPanel({ ...PAID, ...over });
    expect(prepareButton()).toBeNull();
  });

  it.each([
    ["front desk (no money.manage)", { data: { adminRole: "front_desk" }, isLoading: false, isError: false }],
    ["a role still loading", { data: undefined, isLoading: true, isError: false }],
    ["a failed role read", { data: undefined, isLoading: false, isError: true }],
  ])("is absent for %s", async (_label, security) => {
    h.security = security;
    await renderPanel();
    expect(prepareButton()).toBeNull();
  });

  it("is shown to a manager for a paid, confirmed order with no reference", async () => {
    h.security = { data: { adminRole: "manager" }, isLoading: false, isError: false };
    await renderPanel({ ...PAID, status: "confirmed" });
    expect(prepareButton()!.className).toContain("min-h-12");
  });

  it("prepare renders the matched tire, the line table, the cutoff, and a Submit button", async () => {
    await renderPanel();
    await prepare();
    expect(h.prepare).toHaveBeenCalledWith({ orderId: 42 });
    expect(panel().getByText(/MIC12345/)).toBeTruthy();
    const table = panel().getByRole("table");
    expect(within(table).getByText("online order TO-20261018-042")).toBeTruthy();
    expect(within(table).getByText("$96.00")).toBeTruthy();
    expect(within(table).getByText("$384.00")).toBeTruthy();
    expect(panel().getByText("Order by 3 PM for next-day delivery")).toBeTruthy();
    expect(panel().queryByText(/switched off \(GATEWAY_ORDERING_ENABLED\)/)).toBeNull();
    expect(panel().getByRole("button", { name: "Submit to D&K" })).toBeTruthy();
  });

  it("preview: true shows the switched-off badge", async () => {
    h.prepare.mockResolvedValue({ ...PREPARED, preview: true });
    await renderPanel();
    await prepare();
    expect(panel().getByText("Ordering is switched off (GATEWAY_ORDERING_ENABLED). This is what would be sent.")).toBeTruthy();
  });

  it("cartHadOtherLines warns", async () => {
    h.prepare.mockResolvedValue({ ...PREPARED, cartHadOtherLines: true });
    await renderPanel();
    await prepare();
    expect(panel().getByText(/other items in the D&K cart/i)).toBeTruthy();
  });

  it("submit is called only after the confirm dialog says yes, with the cartToken from prepare", async () => {
    await renderPanel();
    await prepare();
    await act(async () => { fireEvent.click(panel().getByRole("button", { name: "Submit to D&K" })); });
    expect(h.submit).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("MIC12345");
    expect(dialog.textContent).toContain("$384.00");
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Place order with D&K" })); });
    expect(h.submit).toHaveBeenCalledWith({ orderId: 42, cartToken: TOKEN });
    expect(panel().getByText("Ordered. D&K reference DK-778899")).toBeTruthy();
    expect(h.invalidateList).toHaveBeenCalled();
  });

  it("cancelling the confirm dialog never submits", async () => {
    await renderPanel();
    await prepare();
    await act(async () => { fireEvent.click(panel().getByRole("button", { name: "Submit to D&K" })); });
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(h.submit).not.toHaveBeenCalled();
  });

  async function prepareAndConfirm() {
    await renderPanel();
    await prepare();
    await act(async () => { fireEvent.click(panel().getByRole("button", { name: "Submit to D&K" })); });
    await act(async () => { fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Place order with D&K" })); });
  }

  it("token_mismatch re-runs prepare and says the cart changed", async () => {
    h.submit.mockResolvedValue({ ok: false, reason: "token_mismatch", detail: "The D&K cart changed since prepare. Prepare again." });
    await prepareAndConfirm();
    expect(h.prepare).toHaveBeenCalledTimes(2);
    expect(panel().getByText(/cart changed/i)).toBeTruthy();
  });

  it("claimed says someone already placed it and refreshes the orders", async () => {
    h.submit.mockResolvedValue({ ok: false, reason: "claimed" });
    await prepareAndConfirm();
    expect(panel().getByText("Someone already placed this order; refreshing")).toBeTruthy();
    expect(h.invalidateList).toHaveBeenCalled();
  });

  it.each([
    ["not_paid", "Waiting for payment."],
    ["already_ordered", "Already ordered."],
    ["no_match", "D&K has no exact match for this tire. Order it in the portal and enter the PO."],
    ["unconfigured", "D&K login is not set up on the server."],
    ["upstream_error", "D&K did not answer. Try again in a minute."],
  ])("prepare %s -> one plain sentence, the detail as-is, and no table or zero total", async (reason, text) => {
    h.prepare.mockResolvedValue({ ok: false, reason, detail: "D&K search failed" });
    await renderPanel();
    await prepare();
    expect(panel().getByText(text)).toBeTruthy();
    expect(panel().getByText("D&K search failed")).toBeTruthy();
    expect(panel().queryByRole("table")).toBeNull();
    expect(panel().queryByText("$0.00")).toBeNull();
    expect(panel().queryByRole("button", { name: "Submit to D&K" })).toBeNull();
  });

  it("upstream_error offers Retry, which prepares again", async () => {
    h.prepare.mockResolvedValueOnce({ ok: false, reason: "upstream_error" }).mockResolvedValue(PREPARED);
    await renderPanel();
    await prepare();
    await act(async () => { fireEvent.click(panel().getByRole("button", { name: "Retry" })); });
    expect(h.prepare).toHaveBeenCalledTimes(2);
    expect(panel().getByRole("table")).toBeTruthy();
  });

  it("cart_not_empty explains and offers Retry", async () => {
    h.prepare.mockResolvedValue({ ok: false, reason: "cart_not_empty", otherLines: [LINE] });
    await renderPanel();
    await prepare();
    expect(panel().getByText("The D&K cart has other items in it. Clear it in the portal, then prepare again.")).toBeTruthy();
    expect(panel().getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  const leased = (status: string) => ({ data: { ok: true, lease: { status, uid: "app_1", orderNumber: PAID.orderNumber } }, isLoading: false, isError: false });

  it.each(["signed", "activating", "activated"])("an unpaid order with a Kafene lease %s gets the D&K panel", async (status) => {
    h.kafeneStatus = leased(status);
    await renderPanel({ ...PAID, paymentStatus: "pending" });
    expect(prepareButton()).toBeTruthy();
  });

  it.each([
    ["no lease", { data: { ok: true, lease: null }, isLoading: false, isError: false }],
    ["a lease only applied", leased("applied")],
    ["a failed lease read", { data: undefined, isLoading: false, isError: true }],
    ["lease records not installed", { data: { ok: false, reason: "not_installed" }, isLoading: false, isError: false }],
  ])("an unpaid order with %s stays hidden", async (_label, status) => {
    h.kafeneStatus = status as any;
    await renderPanel({ ...PAID, paymentStatus: "pending" });
    expect(prepareButton()).toBeNull();
  });

  it("submit cart_mismatch -> one line next to the clear button, no retry", async () => {
    h.submit.mockResolvedValue({ ok: false, reason: "cart_mismatch" });
    await prepareAndConfirm();
    expect(panel().getByText("The D&K cart does not match this order. Clear our lines and prepare again.")).toBeTruthy();
    expect(panel().getByRole("button", { name: "Remove my lines from the D&K cart" })).toBeTruthy();
    expect(panel().queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("submit disabled -> the switched-off sentence", async () => {
    h.submit.mockResolvedValue({ ok: false, reason: "disabled" });
    await prepareAndConfirm();
    expect(panel().getByText("Online ordering is switched off. Place it in the D&K portal and enter the PO here.")).toBeTruthy();
  });

  it("a prepare call that throws is an error message, not a blank", async () => {
    h.prepare.mockRejectedValue(new Error("network"));
    await renderPanel();
    await prepare();
    expect(panel().getByText("D&K did not answer. Try again in a minute.")).toBeTruthy();
    expect(panel().getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("ambiguous_match lists the candidates as 48 px radio rows; Use this part prepares with that partNumber", async () => {
    const other = { ...MATCH, partNumber: "MIC99999", model: "Defender LTX" };
    h.prepare.mockResolvedValueOnce({ ok: false, reason: "ambiguous_match", candidates: [MATCH, other] }).mockResolvedValue(PREPARED);
    await renderPanel();
    await prepare();
    const radios = panel().getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0].closest("label")!.className).toContain("min-h-12");
    fireEvent.click(radios[1]);
    await act(async () => { fireEvent.click(panel().getByRole("button", { name: "Use this part" })); });
    expect(h.prepare).toHaveBeenLastCalledWith({ orderId: 42, partNumber: "MIC99999" });
  });

  it("after a prepare that wrote lines, Remove my lines calls clearOurLines; not shown after a preview", async () => {
    await renderPanel();
    await prepare();
    await act(async () => { fireEvent.click(panel().getByRole("button", { name: "Remove my lines from the D&K cart" })); });
    expect(h.clearOurLines).toHaveBeenCalledWith({ orderId: 42 });

    cleanup();
    h.prepare.mockResolvedValue({ ...PREPARED, preview: true });
    await renderPanel();
    await prepare();
    expect(panel().queryByRole("button", { name: "Remove my lines from the D&K cart" })).toBeNull();
  });
});

describe("TireOrdersSection renders the panel in the order detail", () => {
  afterEach(cleanup);

  it("expanding a paid order shows Prepare D&K order", async () => {
    h.security = { data: { adminRole: "owner" }, isLoading: false, isError: false };
    h.orders = [PAID];
    const { default: TireOrdersSection } = await import("@/pages/admin/TireOrdersSection");
    render(React.createElement(TireOrdersSection));
    expect(prepareButton()).toBeNull();
    fireEvent.click(screen.getByText("TO-20261018-042"));
    expect(prepareButton()).toBeTruthy();
  });
});
