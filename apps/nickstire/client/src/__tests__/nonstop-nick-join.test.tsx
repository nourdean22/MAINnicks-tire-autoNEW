/**
 * NonstopNickJoin — behavior tests (2026-06-11 launch readiness).
 *
 * The join card is the public top of the membership money path, so its
 * contract is pinned: client-side phone validation, plan selection carried
 * into the mutation, the honest no-checkout fallback (never a fake success),
 * the Stripe redirect, and the ?joined=1 welcome state Stripe returns to.
 *
 * Queries are scoped to this render's container (within) — the suite runs
 * non-isolated in single-fork mode, so document.body can hold renders from
 * other test files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, within, fireEvent, act, cleanup } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  opts: { current: null as any },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    memberships: {
      startCheckout: {
        useMutation: (opts: any) => {
          h.opts.current = opts;
          return { mutate: h.mutate, isPending: false };
        },
      },
    },
  },
}));

import NonstopNickJoin from "../components/NonstopNickJoin";

const originalLocation = window.location;

function stubLocation(search = "") {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { href: "http://localhost/nonstop-nick", search },
  });
}

/** Render the join card and return queries scoped to THIS render only. */
function setup() {
  const { container } = render(<NonstopNickJoin />);
  return within(container);
}

beforeEach(() => {
  h.mutate.mockReset();
  h.opts.current = null;
  stubLocation("");
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

describe("NonstopNickJoin", () => {
  it("renders both tiers with the base plan selected by default", () => {
    const q = setup();
    // Tile names via their benefit copy — /\$7\.99/ alone would also match the CTA.
    const base = q.getByRole("button", { name: /pull up anytime/i });
    const plus = q.getByRole("button", { name: /15% off any repair/i });
    expect(base.getAttribute("aria-pressed")).toBe("true");
    expect(plus.getAttribute("aria-pressed")).toBe("false");
    expect(q.getByRole("button", { name: /Join — \$7\.99\/mo/ })).toBeTruthy();
  });

  it("rejects a short phone client-side and never calls the mutation", () => {
    const q = setup();
    fireEvent.change(q.getByLabelText(/your phone number/i), { target: { value: "555-0123" } });
    fireEvent.click(q.getByRole("button", { name: /Join — / }));
    expect(q.getByText(/valid 10-digit phone number/i)).toBeTruthy();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("submits digits-only phone with the selected base plan", () => {
    const q = setup();
    fireEvent.change(q.getByLabelText(/your phone number/i), { target: { value: "(216) 555-0123" } });
    fireEvent.click(q.getByRole("button", { name: /Join — / }));
    expect(h.mutate).toHaveBeenCalledWith({ phone: "2165550123", plan: "nonstop-nick" });
  });

  it("carries the plus plan when selected (CTA price follows)", () => {
    const q = setup();
    fireEvent.click(q.getByRole("button", { name: /15% off any repair/i }));
    expect(q.getByRole("button", { name: /Join — \$9\.99\/mo/ })).toBeTruthy();
    fireEvent.change(q.getByLabelText(/your phone number/i), { target: { value: "2165550123" } });
    fireEvent.click(q.getByRole("button", { name: /Join — / }));
    expect(h.mutate).toHaveBeenCalledWith({ phone: "2165550123", plan: "nonstop-nick-plus" });
  });

  it("shows the honest fallback message when no checkout URL comes back", () => {
    const q = setup();
    act(() => {
      h.opts.current.onSuccess({ url: null, error: "Membership signup isn't online yet — call or text (216) 862-0005, or ask at the counter." });
    });
    expect(q.getByText(/isn't online yet/)).toBeTruthy();
  });

  it("redirects to Stripe when a checkout URL is returned", () => {
    setup();
    act(() => {
      h.opts.current.onSuccess({ url: "https://checkout.stripe.com/c/pay/cs_test_1", error: null });
    });
    expect(window.location.href).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
  });

  it("shows a call-us message on a network/mutation error", () => {
    const q = setup();
    act(() => {
      h.opts.current.onError();
    });
    expect(q.getByText(/Couldn't start signup right now/)).toBeTruthy();
  });

  it("renders the welcome state (no form) when Stripe returns with ?joined=1", () => {
    stubLocation("?joined=1");
    const q = setup();
    expect(q.getByText(/You're in\. Pull up when you need us\./)).toBeTruthy();
    expect(q.getByText(/look you up by phone at the counter/i)).toBeTruthy();
    expect(q.getByText(/register your covered vehicle/i)).toBeTruthy();
    expect(q.queryByLabelText(/your phone number/i)).toBeNull();
  });
});
