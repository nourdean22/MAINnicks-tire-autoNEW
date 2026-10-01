/**
 * The homepage review showcase quotes 5-star Google reviews. A rating-only
 * review has no words: on 2026-10-01 the live feed's newest 5-star review had
 * text "", and the card rendered it as an empty pair of quotation marks. The
 * showcase now requires text; FALLBACK_REVIEWS fill the grid.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  useLocation: () => ["/", vi.fn()],
  useSearch: () => window.location.search,
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy({}, { get: (_t, prop) => React.forwardRef((props: any, ref: any) => {
    const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, drag, dragConstraints, layout, layoutId, ...rest } = props;
    return React.createElement(typeof prop === "string" ? prop : "div", { ...rest, ref });
  }) }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
  useAnimation: () => ({ start: vi.fn(), set: vi.fn() }),
  useScroll: () => ({ scrollYProgress: { get: () => 0 } }),
  useTransform: () => 0,
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
}));

const GOOGLE = {
  rating: 4.9,
  totalReviews: 1715,
  reviews: [
    { authorName: "Rating Only", rating: 5, text: "", relativeTime: "1 week ago", time: 3 },
    { authorName: "Wrote Something", rating: 5, text: "Brakes done right and explained.", relativeTime: "1 week ago", time: 2 },
  ],
};
const empty = { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext"
      ? () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn(), refetch: vi.fn() }) }) })
      : new Proxy({}, { get: (_n, proc) => ({
          useQuery: () => (ns === "reviews" && proc === "google" ? { ...empty, data: GOOGLE } : empty),
          useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
        }) }),
  }),
}));

async function renderHome() {
  const { default: Home } = await import("../pages/Home");
  return render(React.createElement(Home));
}

describe("homepage review showcase", () => {
  afterEach(cleanup);

  it("does not render a rating-only review as an empty quote", async () => {
    const { container } = await renderHome();
    const quotes = [...container.querySelectorAll("p")].map((p) => p.textContent?.trim());
    expect(quotes).not.toContain('""');
    expect(container.textContent).not.toContain("Rating Only");
  });

  it("CONTROL: a 5-star review with text is still quoted", async () => {
    const { container } = await renderHome();
    expect(container.textContent).toContain("Brakes done right and explained.");
  });
});
