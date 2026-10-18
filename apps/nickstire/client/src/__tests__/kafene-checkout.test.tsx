/**
 * "Pay with Kafene lease" in the shared OrderModal, after placeOrder succeeds.
 * Contract kafene v1 (server lane) is mocked exactly; the SDK is a stub
 * `window.kafene` whose flow the test drives (approved / result statuses).
 * No network: the SDK loader sees the stub global and inserts no script,
 * except in the load-failure test, which fires the script's error event.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import React from "react";

const ORDER = "TO-20261018-101";
const PHONE = "(216) 555-9999";
const START_OK = {
  ok: true as const,
  orderId: ORDER,
  items: [{ model: "Michelin Defender", description: "Michelin Defender 215/60R16 x4", price: 150, quantity: 4, condition: "New", damage: "", leasable: true }],
  shippingCost: 0,
  customer: { billing: { firstName: "Nour", lastName: "Test", phone: PHONE } },
};

const h = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  config: { data: undefined as any, isLoading: false, isError: false },
  start: vi.fn(),
  attach: vi.fn(),
  markSigned: vi.fn(),
  createCheckout: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

// One stable component per tag, as real framer-motion gives: a fresh forwardRef per access
// would remount the modal panel on every render and wipe the checkout's state.
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

vi.mock("@/components/SEO", () => ({ trackEvent: (...a: any[]) => h.trackEvent(...a), trackPhoneClick: vi.fn() }));

vi.mock("@/lib/trpc", () => {
  const proc = (key: string) => ({
    useQuery: () => (key === "kafene.config" ? h.config : { data: undefined, isLoading: false, isError: false }),
    useMutation: (opts?: any) => {
      if (key === "gatewayTire.placeOrder") {
        return { mutate: () => opts?.onSuccess?.({ success: true, orderNumber: ORDER, invoiceNumber: "INV-1", totalAmount: 0 }), isPending: false };
      }
      if (key === "gatewayTire.createCheckout") return { mutate: h.createCheckout, isPending: false };
      const fn = key === "kafene.start" ? h.start : key === "kafene.attach" ? h.attach : key === "kafene.markSigned" ? h.markSigned : vi.fn();
      return { mutate: vi.fn(), mutateAsync: (...a: any[]) => fn(...a), isPending: false };
    },
  });
  const trpc = new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext" ? () => ({}) : new Proxy({}, { get: (_t2, p) => proc(`${String(ns)}.${String(p)}`) }),
  });
  return { trpc };
});

const ENABLED = { enabled: true, apiKey: "pk_test_123", storeId: "store-approve", environment: "sandbox", maxApprovalCents: 500000 };

/** A stub Kafene SDK whose checkout flow the test controls. */
function stubKafene() {
  const handlers: Record<string, Array<(p?: any) => void>> = {};
  let resolveResult!: (v: { status: string; message?: string }) => void;
  const flow: any = {
    on(ev: string, fn: (p?: any) => void) { (handlers[ev] ??= []).push(fn); return flow; },
    result: new Promise((r) => { resolveResult = r; }),
  };
  const openCheckout = vi.fn(() => flow);
  const init = vi.fn(() => ({ openCheckout }));
  (window as any).kafene = { init };
  return {
    init,
    openCheckout,
    emit: async (ev: string, p?: any) => { await act(async () => { handlers[ev]?.forEach((fn) => fn(p)); }); },
    // The component awaits result, then attach/markSigned: let those promise hops settle inside act.
    finish: async (status: string, message?: string) => {
      await act(async () => {
        resolveResult({ status, message });
        await new Promise((r) => setTimeout(r, 0));
      });
    },
  };
}

const onClose = vi.fn();

async function placeOrder() {
  const { OrderModal } = await import("@/components/order/TireOrderModal");
  render(React.createElement(OrderModal, {
    tire: { name: "Defender", brand: "Michelin", model: "Defender", size: "215/60R16", shopPrice: 150, pricePerTireCents: 15000 },
    quantity: 4,
    packageValue: 266,
    onClose,
  }));
  fireEvent.change(screen.getByPlaceholderText("John Smith"), { target: { value: "Nour Test" } });
  fireEvent.change(screen.getByPlaceholderText("(216) 555-0000"), { target: { value: PHONE } });
  fireEvent.change(screen.getByPlaceholderText("2020"), { target: { value: "2018" } });
  fireEvent.change(screen.getByPlaceholderText("Honda"), { target: { value: "Honda" } });
  fireEvent.change(screen.getByPlaceholderText("Civic"), { target: { value: "Civic" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Request These Tires/ })); });
}

const kafeneButton = () => screen.queryByRole("button", { name: "Pay with Kafene lease" });
const cardButton = () => screen.queryByRole("button", { name: /Pay Now/ });

async function openKafene() {
  await act(async () => { fireEvent.click(kafeneButton()!); });
}

describe("OrderModal · Pay with Kafene lease", () => {
  beforeEach(() => {
    h.trackEvent.mockClear();
    onClose.mockClear();
    h.config = { data: ENABLED, isLoading: false, isError: false };
    h.start.mockReset().mockResolvedValue(START_OK);
    h.attach.mockReset().mockResolvedValue({ ok: true });
    h.markSigned.mockReset().mockResolvedValue({ ok: true, status: "signed" });
  });
  afterEach(() => {
    cleanup();
    delete (window as any).kafene;
    document.querySelectorAll('script[src^="https://sdk.kafene.com/"], link[href^="https://sdk.kafene.com/"]').forEach((n) => n.remove());
    vi.useRealTimers();
  });

  it("hidden when kafene.config says disabled (or has not loaded); the card button is still there", async () => {
    h.config = { data: { enabled: false, apiKey: null, storeId: null, environment: null, maxApprovalCents: null }, isLoading: false, isError: false };
    await placeOrder();
    expect(kafeneButton()).toBeNull();
    expect(cardButton()).toBeTruthy();
    cleanup();
    h.config = { data: undefined, isLoading: false, isError: true };
    await placeOrder();
    expect(kafeneButton()).toBeNull();
  });

  it("enabled: shows the 48 px choice with its one-line note beside the card button", async () => {
    await placeOrder();
    expect(kafeneButton()!.className).toContain("min-h-12");
    expect(screen.getByText("Lease-to-own through Kafene. Kafene decides approval.")).toBeTruthy();
    expect(cardButton()).toBeTruthy();
  });

  it("opens Kafene's checkout with the server's items and ids, and the config only from the server", async () => {
    const k = stubKafene();
    await placeOrder();
    await openKafene();
    expect(h.start).toHaveBeenCalledWith({ orderNumber: ORDER, phone: PHONE });
    expect(k.init).toHaveBeenCalledWith({ apiKey: "pk_test_123", storeId: "store-approve", environment: "sandbox" });
    expect(k.openCheckout).toHaveBeenCalledWith({
      orderId: ORDER, items: START_OK.items, shippingCost: 0, customer: START_OK.customer,
    });
    expect(h.trackEvent).toHaveBeenCalledWith("kafene_checkout_opened", { orderNumber: ORDER });
    expect(window.location.search).not.toContain("pk_test_123");
  });

  it("approved -> attach is called once with the uid", async () => {
    const k = stubKafene();
    await placeOrder();
    await openKafene();
    await k.emit("approved", { uid: "lease-uid-1" });
    await k.emit("approved", { uid: "lease-uid-1" });
    expect(h.attach).toHaveBeenCalledTimes(1);
    expect(h.attach).toHaveBeenCalledWith({ orderNumber: ORDER, phone: PHONE, uid: "lease-uid-1" });
  });

  it("attach retries once on a network error, never on a business answer", async () => {
    const k = stubKafene();
    h.attach.mockReset().mockRejectedValueOnce(new Error("fetch failed")).mockResolvedValue({ ok: true });
    await placeOrder();
    await openKafene();
    await k.emit("approved", { uid: "lease-uid-1" });
    expect(h.attach).toHaveBeenCalledTimes(2);

    cleanup();
    const k2 = stubKafene();
    h.attach.mockReset().mockResolvedValue({ ok: false, reason: "conflict" });
    await placeOrder();
    await openKafene();
    await k2.emit("approved", { uid: "lease-uid-2" });
    expect(h.attach).toHaveBeenCalledTimes(1);
  });

  it("completed -> markSigned with the uid, the plain confirmation with the order number, and no card button", async () => {
    const k = stubKafene();
    await placeOrder();
    await openKafene();
    await k.emit("approved", { uid: "lease-uid-1" });
    await k.finish("completed");
    expect(h.markSigned).toHaveBeenCalledWith({ orderNumber: ORDER, phone: PHONE, uid: "lease-uid-1" });
    expect(screen.getByText("Lease signed. We'll text you when your tires are in. Nothing more to pay today.")).toBeTruthy();
    expect(screen.getAllByText(new RegExp(ORDER)).length).toBeGreaterThan(0);
    expect(cardButton()).toBeNull(); // a signed lease must not invite a second payment
    expect(h.trackEvent).toHaveBeenCalledWith("kafene_checkout_result", { status: "completed" });
  });

  it("completed but markSigned fails: still no card button, and the customer is told to call with the order number", async () => {
    const k = stubKafene();
    h.markSigned.mockReset().mockResolvedValue({ ok: false, reason: "unknown_uid" });
    await placeOrder();
    await openKafene();
    await k.emit("approved", { uid: "lease-uid-1" });
    await k.finish("completed");
    expect(screen.getByText("Lease signed. We'll text you when your tires are in. Nothing more to pay today.")).toBeTruthy();
    expect(screen.getByText(/Call us at \(216\) 862-0005 with this order number/)).toBeTruthy();
    expect(cardButton()).toBeNull();
  });

  it.each([
    ["declined", "Kafene didn't approve this one. You can still pay by card or call us."],
    ["cancelled", "Kafene checkout closed. Your order is saved; pay by card or call us."],
    ["error", "Kafene checkout couldn't finish. Try again or pay by card."],
  ])("%s -> a plain message, no markSigned, the card button still offered", async (status, message) => {
    const k = stubKafene();
    await placeOrder();
    await openKafene();
    await k.finish(status);
    expect(screen.getByText(message)).toBeTruthy();
    expect(h.markSigned).not.toHaveBeenCalled();
    expect(cardButton()).toBeTruthy();
    expect(kafeneButton()).toBeTruthy(); // can try again
    expect(h.trackEvent).toHaveBeenCalledWith("kafene_checkout_result", { status });
  });

  it("over_limit from start -> the limit message, Kafene never opens, card still offered", async () => {
    const k = stubKafene();
    h.start.mockReset().mockResolvedValue({ ok: false, reason: "over_limit" });
    await placeOrder();
    await openKafene();
    expect(screen.getByText("This order is above Kafene's limit for our shop. Pay by card or call us.")).toBeTruthy();
    expect(k.openCheckout).not.toHaveBeenCalled();
    expect(cardButton()).toBeTruthy();
  });

  it("already_paid from start -> says so and does not invite a card payment", async () => {
    stubKafene();
    h.start.mockReset().mockResolvedValue({ ok: false, reason: "already_paid" });
    await placeOrder();
    await openKafene();
    expect(screen.getByText("This order is already paid.")).toBeTruthy();
  });

  it("SDK script fails to load -> a message, never a blank", async () => {
    await placeOrder(); // no window.kafene: the loader inserts the script
    await openKafene();
    const script = document.querySelector('script[src="https://sdk.kafene.com/plugin/js/kafene.js"]')!;
    expect(script).toBeTruthy();
    await act(async () => { script.dispatchEvent(new Event("error")); });
    expect(screen.getByText("Kafene checkout couldn't finish. Try again or pay by card.")).toBeTruthy();
    expect(cardButton()).toBeTruthy();
  });

  it("a start call that never answers ends in a message, not a spinner forever", async () => {
    stubKafene();
    h.start.mockReset().mockReturnValue(new Promise(() => {}));
    await placeOrder();
    vi.useFakeTimers();
    await openKafene();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByText("Kafene checkout couldn't finish. Try again or pay by card.")).toBeTruthy();
  });

  it("while Kafene's overlay is open our modal neither traps focus nor closes on Escape", async () => {
    const k = stubKafene();
    await placeOrder();
    await openKafene();
    const iframeStandIn = document.createElement("button");
    document.body.appendChild(iframeStandIn);
    iframeStandIn.focus();
    // Our focus trap would cancel this Tab and pull focus back into the panel.
    expect(fireEvent.keyDown(iframeStandIn, { key: "Tab" })).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    // Our dialog steps aside so it cannot sit on top of Kafene's overlay.
    expect(screen.getByRole("dialog", { hidden: true }).closest("[aria-hidden='true']")).toBeTruthy();
    iframeStandIn.remove();

    await k.finish("cancelled");
    expect(screen.getByRole("dialog").closest("[aria-hidden='true']")).toBeNull();
  });
});
