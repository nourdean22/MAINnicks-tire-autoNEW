/**
 * ShopStrip — the four facts, in both shop states, with real hrefs.
 *
 * The clock is faked (Date only) so the strip renders a known state; the
 * interval that re-checks every 60 s is left real and harmless.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { BUSINESS } from "@shared/business";

vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: () => new Proxy({}, {
      get: () => ({
        useQuery: () => ({ data: { totalReviews: 1709 }, isLoading: false, error: null }),
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
      }),
    }),
  }),
}));
const trackPhoneClick = vi.fn();
vi.mock("@/components/SEO", () => ({ trackPhoneClick: (...a: unknown[]) => trackPhoneClick(...a) }));

async function renderStrip(props: { collapsed?: boolean } = {}) {
  const { default: ShopStrip, EMERGENCY_REQUEST_EVENT } = await import("../components/ShopStrip");
  const utils = render(React.createElement(ShopStrip, props));
  return { ...utils, EMERGENCY_REQUEST_EVENT };
}

describe("ShopStrip", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
  afterEach(() => { vi.useRealTimers(); trackPhoneClick.mockClear(); });

  it("open (Monday noon ET): state + closing time, rating with the live count, address → directions, phone → tel:", async () => {
    vi.setSystemTime(new Date("2026-09-14T16:00:00Z"));
    await renderStrip();

    expect(screen.getAllByText("Open").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Closes 6 PM/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4\.9 · 1,709\+ Google reviews/).length).toBeGreaterThan(0);

    const directions = screen.getAllByRole("link", { name: /17625 Euclid Ave, Cleveland/ });
    expect(directions[0].getAttribute("href")).toBe(BUSINESS.urls.googleMapsDirections);
    expect(directions[0].getAttribute("rel")).toContain("noopener");

    const call = screen.getAllByRole("link", { name: /\(216\) 862-0005/ });
    expect(call[0].getAttribute("href")).toBe("tel:+12168620005");
    fireEvent.click(call[0]);
    expect(trackPhoneClick).toHaveBeenCalledWith("shop_strip");

    expect(screen.queryByRole("button", { name: /emergency/i })).toBeNull();
  });

  it("closed (Monday 6:30 PM ET): state + next opening, and the Emergency button raises the window event", async () => {
    vi.setSystemTime(new Date("2026-09-14T22:30:00Z"));
    const { EMERGENCY_REQUEST_EVENT } = await renderStrip();

    expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Opens tomorrow 8 AM/).length).toBeGreaterThan(0);

    const heard = vi.fn();
    window.addEventListener(EMERGENCY_REQUEST_EVENT, heard);
    try {
      fireEvent.click(screen.getAllByRole("button", { name: /emergency/i })[0]);
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(EMERGENCY_REQUEST_EVENT, heard);
    }
    // canary: the event name is the contract EmergencyMode subscribes to.
    expect(EMERGENCY_REQUEST_EVENT).toBe("nickstire:emergency-request");
  });

  it("collapsed: hidden from assistive tech and zero height class", async () => {
    vi.setSystemTime(new Date("2026-09-14T16:00:00Z"));
    const { container } = await renderStrip({ collapsed: true });
    const strip = container.querySelector("[data-shop-strip]")!;
    expect(strip.getAttribute("aria-hidden")).toBe("true");
    expect(strip.className).toContain("max-h-0");
  });
});
