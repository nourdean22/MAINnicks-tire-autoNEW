/**
 * NonstopNickTopBar — line-hopper copy pins (2026-07-04).
 *
 *  1. LIVE price ($7.99/mo) — the bar must never drift from the
 *     NonstopNickJoin tier pricing (a $14.99 draft nearly shipped; the
 *     pricing source of truth is the Stripe-backed join card).
 *  2. Only shipped benefits — "pull up anytime" / $0 flats. No
 *     queue-priority or express-service guarantees that aren't honored
 *     at the counter.
 *  3. Route suppression stays: /tires, /tire-finder and /nonstop-nick
 *     own their own messaging (LCP + strip-stacking note in the
 *     component header). /tires gets its membership pitch from the
 *     in-page NonstopNickJoin surface instead.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mockLocation = vi.hoisted(() => ({ path: "/" }));

vi.mock("wouter", () => ({
  useLocation: () => [mockLocation.path, vi.fn()],
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import NonstopNickTopBar from "@/components/NonstopNickTopBar";

afterEach(cleanup);

describe("NonstopNickTopBar", () => {
  it("renders the line-hopper copy at the LIVE $7.99 price, linking to /nonstop-nick", () => {
    mockLocation.path = "/";
    render(<NonstopNickTopBar />);
    const bar = screen.getByTestId("nonstop-nick-top-bar");
    expect(bar.getAttribute("href")).toBe("/nonstop-nick");
    expect(bar.textContent).toMatch(/Euclid Ave line/i);
    expect(bar.textContent).toContain("$7.99/mo");
    // Pricing drift guard — the $14.99 draft price must never ship.
    expect(bar.textContent).not.toContain("$14.99");
    // Unverified-promise guard — no queue-jump guarantees in the bar.
    expect(bar.textContent).not.toMatch(/priority bay|30.?minute|guaranteed/i);
  });

  it.each(["/tires", "/tire-finder", "/nonstop-nick"])(
    "stays suppressed on %s (route owns its messaging)",
    (route) => {
      mockLocation.path = route;
      render(<NonstopNickTopBar />);
      expect(screen.queryByTestId("nonstop-nick-top-bar")).toBeNull();
    },
  );
});
