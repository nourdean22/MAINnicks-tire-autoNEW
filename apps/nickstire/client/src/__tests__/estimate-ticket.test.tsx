/**
 * FocusedServicePage — the written-estimate ticket and the honest AEO line.
 *
 * Renders the real template with a minimal config and asserts (a) the ticket
 * lists the page's own tiers, verbatim, plus the approval line; (b) the AEO
 * answer no longer promises "you don't pay until you say yes" (false on a
 * page whose diagnostic carries a fee) and says what is always true instead.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: any) => React.createElement("a", { href, ...props }, children),
  Route: ({ children }: any) => React.createElement("div", null, children),
  Switch: ({ children }: any) => React.createElement("div", null, children),
  useLocation: () => ["/brakes", vi.fn()],
  useRoute: () => [true, {}],
  useParams: () => ({}),
  useSearch: () => "",
}));
vi.mock("framer-motion", () => ({
  motion: new Proxy({}, {
    get: (_t, tag) => React.forwardRef((props: any, ref: any) => {
      const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, layout, layoutId, ...rest } = props;
      return React.createElement(tag as string, { ...rest, ref });
    }),
  }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
  useAnimation: () => ({ start: vi.fn(), set: vi.fn() }),
  useScroll: () => ({ scrollYProgress: { get: () => 0 } }),
  useTransform: () => 0,
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "useUtils" || prop === "useContext") {
        return () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn(), refetch: vi.fn() }) }) });
      }
      return new Proxy({}, {
        get: () => ({
          useQuery: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
          useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
        }),
      });
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, Toaster: () => null }));
vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: any) => React.createElement("div", null, children),
  useTheme: () => ({ theme: "dark", setTheme: vi.fn(), resolvedTheme: "dark" }),
}));

const config = {
  canonicalPath: "/test-service",
  title: "Test Service | Nick's",
  description: "Test service page.",
  eyebrow: "TEST",
  h1: "Test service headline",
  sub: "Test subhead.",
  startingPrice: "$59.99 (credited toward repair)",
  pricingTitle: "Pricing",
  pricingSub: "Most vehicles.",
  tiers: [
    { name: "Basic check", price: "$59.99", sub: "credited toward the repair", use: "When you are not sure what it is." },
    { name: "Pads + rotors", price: "From $279", sub: "per axle", use: "The common job.", featured: true },
    { name: "Full job", price: "Quote", use: "Calipers and lines." },
  ],
  includedTitle: "Included",
  includedSub: "Every time.",
  included: ["Written estimate"],
  faqs: [{ q: "Do I need an appointment?", a: "No." }],
  bookingService: "brakes",
  serviceType: "Test Service",
};

describe("FocusedServicePage · written-estimate ticket", () => {
  it("lists the page's own tiers verbatim and the approval line", async () => {
    const { default: FocusedServicePage } = await import("../components/FocusedServicePage");
    render(React.createElement(FocusedServicePage, { config }));

    const ticket = within(screen.getByTestId("estimate-ticket"));
    expect(ticket.getByRole("heading", { name: /written estimate/i })).toBeTruthy();
    for (const t of config.tiers) {
      expect(ticket.getByText(t.name)).toBeTruthy();
      expect(ticket.getByText(t.price)).toBeTruthy();
    }
    expect(ticket.getByText("You approve it. Then we start.")).toBeTruthy();
    expect(ticket.getByText("Parts & labor")).toBeTruthy();
    expect(ticket.getByRole("link", { name: /call \(216\) 862-0005/i }).getAttribute("href")).toBe("tel:+12168620005");
  });

  it("AEO answer: no 'until you say yes'; every charge is on a written estimate you approve first", async () => {
    const { default: FocusedServicePage } = await import("../components/FocusedServicePage");
    const { container } = render(React.createElement(FocusedServicePage, { config }));
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/until you say yes/i);
    expect(text).toMatch(/every charge is on a written estimate you approve first/i);
  });
});
