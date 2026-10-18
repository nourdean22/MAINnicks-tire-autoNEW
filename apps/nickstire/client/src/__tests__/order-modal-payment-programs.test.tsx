/**
 * The payment step after a tire request lists the Payment Programs from the canonical
 * FINANCING_PROVIDERS (shared/financing.ts), Kafene first, so a provider change can never
 * leave this block stale (Codex round 3 on PR 3148). The Stripe card button is unchanged.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import React from "react";
import { FINANCING_PROVIDERS } from "@shared/financing";

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

vi.mock("@/components/SEO", () => ({ trackEvent: vi.fn(), trackPhoneClick: vi.fn() }));

vi.mock("@/lib/trpc", () => {
  const proc = (key: string) => ({
    useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
    useMutation: (opts?: any) => ({
      mutate: () => {
        if (key === "gatewayTire.placeOrder") opts?.onSuccess?.({ success: true, orderNumber: "TO-1", invoiceNumber: "INV-1", totalAmount: 0 });
      },
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  });
  const trpc = new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext" ? () => ({}) : new Proxy({}, { get: (_t2, p) => proc(`${String(ns)}.${String(p)}`) }),
  });
  return { trpc };
});

async function reachPaymentStep() {
  const { OrderModal } = await import("@/components/order/TireOrderModal");
  render(React.createElement(OrderModal, {
    tire: { name: "Defender", brand: "Michelin", model: "Defender", size: "215/60R16", shopPrice: 150, pricePerTireCents: 15000 },
    quantity: 4, packageValue: 266, onClose: vi.fn(),
  }));
  fireEvent.change(screen.getByPlaceholderText("John Smith"), { target: { value: "Nour Test" } });
  fireEvent.change(screen.getByPlaceholderText("(216) 555-0000"), { target: { value: "(216) 555-9999" } });
  fireEvent.change(screen.getByPlaceholderText("2020"), { target: { value: "2018" } });
  fireEvent.change(screen.getByPlaceholderText("Honda"), { target: { value: "Honda" } });
  fireEvent.change(screen.getByPlaceholderText("Civic"), { target: { value: "Civic" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Request These Tires/ })); });
}

describe("OrderModal payment step · Payment Programs", () => {
  afterEach(cleanup);

  it("lists every provider from FINANCING_PROVIDERS, Kafene first, as 48 px new-tab links", async () => {
    await reachPaymentStep();
    const urls = new Set(FINANCING_PROVIDERS.map((p) => p.applyUrl));
    const links = screen.getAllByRole("link").filter((a) => urls.has(a.getAttribute("href") ?? ""));
    expect(links).toHaveLength(FINANCING_PROVIDERS.length);
    expect(links[0].getAttribute("href")).toBe(FINANCING_PROVIDERS.find((p) => p.id === "kafene")!.applyUrl);
    expect(links[0].textContent).toContain("Kafene");
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
      expect(a.className).toContain("min-h-12");
    }
  });

  it("keeps the Stripe card button and never says financing in the block", async () => {
    await reachPaymentStep();
    expect(screen.getByRole("button", { name: /Pay Now/ })).toBeTruthy();
    expect(screen.queryByText(/Snap\/Acima/)).toBeNull();
    expect(screen.queryByText(/financing/i)).toBeNull();
  });
});
