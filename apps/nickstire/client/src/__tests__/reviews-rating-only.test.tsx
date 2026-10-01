/**
 * Rating-only Google reviews on /reviews.
 *
 * Google lets a customer leave stars without writing anything. On 2026-10-01
 * three of the five reviews the live Places feed returned had text "" (5, 4 and
 * 3 stars), and /reviews rendered each as a card with an empty paragraph, while
 * the review JSON-LD carried `"reviewBody": ""`. The card now says what it is,
 * and the schema omits the body instead of emitting an empty one.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: (_t, prop) => React.forwardRef((props: any, ref: any) => {
    const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, layout, layoutId, ...rest } = props;
    return React.createElement(typeof prop === "string" ? prop : "div", { ...rest, ref });
  }) }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
}));

const REVIEWS = [
  { authorName: "Driver A", rating: 5, text: "", relativeTime: "1 week ago" },
  { authorName: "Driver B", rating: 4, text: "Four star visit, fair price.", relativeTime: "2 weeks ago" },
];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    reviews: {
      google: {
        useQuery: () => ({
          data: { rating: 4.9, totalReviews: 1715, reviews: REVIEWS },
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

function reviewSchema(container: HTMLElement): { review?: Array<Record<string, unknown>> } | undefined {
  for (const s of container.querySelectorAll('script[type="application/ld+json"]')) {
    const parsed = JSON.parse(s.textContent ?? "{}");
    if (Array.isArray(parsed.review)) return parsed;
  }
  return undefined;
}

describe("rating-only reviews on /reviews", () => {
  it("says the customer left a rating without a written review", () => {
    render(<ReviewsPage />);
    expect(screen.getByText("Left a 5-star rating without a written review.")).toBeTruthy();
  });

  it("CONTROL: a review with text still renders its text, not the rating-only line", () => {
    render(<ReviewsPage />);
    // highlightKeywords wraps service words ("price") in their own element, so
    // match a fragment that stays in one text node.
    expect(screen.getByText(/Four star visit/)).toBeTruthy();
    expect(screen.queryByText("Left a 4-star rating without a written review.")).toBeNull();
  });

  it("omits reviewBody for the rating-only review and keeps it for the written one", () => {
    const { container } = render(<ReviewsPage />);
    const schema = reviewSchema(container);
    expect(schema, "review JSON-LD was not rendered").toBeDefined();
    const byAuthor = Object.fromEntries(
      (schema!.review ?? []).map((r) => [(r.author as { name: string }).name, r]),
    );
    expect(byAuthor["Driver A"]).toBeDefined();
    expect("reviewBody" in byAuthor["Driver A"]).toBe(false);
    expect(byAuthor["Driver B"].reviewBody).toBe("Four star visit, fair price.");
  });
});
