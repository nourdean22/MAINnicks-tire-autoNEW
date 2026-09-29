/**
 * /reviews — the default 4-5 star filter must be disclosed next to the count.
 *
 * The hero prints the TOTAL Google review count and average (every rating),
 * while the list below hides 1-3 star reviews by default. Before 2026-09-29
 * the hero also said "live Google data" and nothing near it said the list was
 * filtered, which implied the visitor was seeing the reviews as Google has
 * them. 16 CFR 465.7(b) prohibits implying displayed reviews represent most
 * or all reviews while suppressing by rating; the Google Places policy
 * requires a clear notice of how reviews are ordered and filtered.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: (_t, prop) => React.forwardRef((props: any, ref: any) => {
    const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, layout, layoutId, ...rest } = props;
    return React.createElement(typeof prop === "string" ? prop : "div", { ...rest, ref });
  }) }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
}));

const REVIEWS = [
  { authorName: "Driver A", rating: 5, text: "Five star visit, honest quote.", relativeTime: "2 days ago" },
  { authorName: "Driver B", rating: 4, text: "Four star visit, fair price.", relativeTime: "3 days ago" },
  { authorName: "Driver C", rating: 2, text: "Two star visit, waited too long.", relativeTime: "4 days ago" },
];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    reviews: {
      google: {
        useQuery: () => ({
          data: { rating: 4.9, totalReviews: 1710, reviews: REVIEWS },
          isLoading: false,
          isError: false,
        }),
      },
    },
  },
}));

vi.mock("@/components/SEO", () => ({
  SEOHead: () => null,
  Breadcrumbs: () => null,
  trackPhoneClick: vi.fn(),
  trackEvent: vi.fn(),
}));
vi.mock("@/components/PageLayout", () => ({
  default: ({ children }: any) => React.createElement("div", null, children),
}));
vi.mock("@/components/LocalBusinessSchema", () => ({ default: () => null }));
vi.mock("@/components/ReviewCTA", () => ({ default: () => null }));
vi.mock("@/hooks/useBusinessHours", () => ({ useBusinessHours: () => ({ isOpen: true }) }));

import ReviewsPage from "@/pages/ReviewsPage";

const DISCLOSURE = "reviews-filter-disclosure";

describe("ReviewsPage rating-filter disclosure", () => {
  it("discloses the default 4-5 star filter next to the count, and the low rating is hidden", () => {
    render(<ReviewsPage />);
    expect(screen.getByTestId(DISCLOSURE).textContent).toMatch(/4- and 5-star reviews only/i);
    expect(screen.queryByText(/Two star visit/)).toBeNull();
    // The hero must not imply the list is the complete Google record.
    expect(screen.queryByText(/live Google data/i)).toBeNull();
  });

  it("drops the disclosure and shows every rating once All ratings is on", () => {
    render(<ReviewsPage />);
    fireEvent.click(screen.getByRole("button", { name: "All ratings" }));
    expect(screen.queryByTestId(DISCLOSURE)).toBeNull();
    expect(screen.getByText(/Two star visit/)).toBeTruthy();
  });

  it("the disclosure's own link turns every rating on", () => {
    render(<ReviewsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Show all ratings" }));
    expect(screen.queryByTestId(DISCLOSURE)).toBeNull();
    expect(screen.getByText(/Two star visit/)).toBeTruthy();
  });
});
