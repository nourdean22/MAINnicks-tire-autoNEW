/**
 * /about quote wall — the five-star selection must be disclosed.
 *
 * The wall sits under the aggregate Google rating and count, and every quote on
 * it is a hand-picked five-star review. Without saying so, a visitor reads it as
 * a fair sample. 16 CFR 465.7(b) prohibits implying displayed reviews represent
 * most or all reviews while suppressing by rating; same rule as /reviews
 * (reviews-page-filter-disclosure.test.tsx).
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  useLocation: () => ["/about", vi.fn()],
  useSearch: () => window.location.search,
  useParams: () => ({}),
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
  useReducedMotion: () => true,
}));

const mockQueryResult = { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: (_t, ns) => ns === "useUtils" || ns === "useContext"
      ? () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn(), refetch: vi.fn() }) }) })
      : new Proxy({}, { get: () => ({
          useQuery: () => mockQueryResult,
          useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
        }) }),
  }),
}));

describe("/about quote wall disclosure", () => {
  afterEach(cleanup);

  it("says the quotes are selected five-star Google reviews", async () => {
    const { default: About } = await import("../pages/About");
    render(React.createElement(About));
    expect(screen.getByTestId("about-quotes-disclosure").textContent).toMatch(
      /^Selected five-star Google reviews, word for word/,
    );
  });

  it("CONTROL: the quotes the disclosure describes are on the page", async () => {
    const { default: About } = await import("../pages/About");
    const { container } = render(React.createElement(About));
    expect(container.querySelectorAll("blockquote").length).toBe(8);
  });
});
